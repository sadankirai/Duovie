import {
  initialPeerConnectionStatus,
  type ParticipantRole,
  type PeerConnectionStatus,
  type RoomIceCandidate,
  type RoomWebRtcAnswer,
  type RoomWebRtcOffer,
} from './contracts'

export interface PeerSignaling {
  isConnected: () => boolean
  sendOffer: (sdp: string) => Promise<void>
  sendAnswer: (sdp: string) => Promise<void>
  sendIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export type PeerConnectionFactory = (configuration: RTCConfiguration) => RTCPeerConnection

export interface WebRtcPeerCallbacks {
  onStatusChanged: (status: PeerConnectionStatus) => void
  onSignalSendFailed: () => void
}

export class WebRtcPeerError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'WebRtcPeerError'
  }
}

export function isWebRtcPeerConnectionSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function'
}

export class WebRtcPeerController {
  private readonly role: ParticipantRole
  private readonly signaling: PeerSignaling
  private readonly callbacks: WebRtcPeerCallbacks
  private readonly peerConnectionFactory: PeerConnectionFactory
  private peerConnection: RTCPeerConnection | null = null
  private hostVideoTransceiver: RTCRtpTransceiver | null = null
  private readonly pendingRemoteCandidates: RTCIceCandidateInit[] = []
  private flushingRemoteCandidates = false
  private negotiationStarted = false

  public constructor(
    role: ParticipantRole,
    signaling: PeerSignaling,
    callbacks: WebRtcPeerCallbacks,
    peerConnectionFactory: PeerConnectionFactory = (configuration) =>
      new RTCPeerConnection(configuration),
  ) {
    this.role = role
    this.signaling = signaling
    this.callbacks = callbacks
    this.peerConnectionFactory = peerConnectionFactory
  }

  public get pendingRemoteCandidateCount(): number {
    return this.pendingRemoteCandidates.length
  }

  public get hostSenderTrackState(): 'not-created' | 'null' | 'attached' {
    if (this.hostVideoTransceiver === null) {
      return 'not-created'
    }

    return this.hostVideoTransceiver.sender.track === null ? 'null' : 'attached'
  }

  public async startHostNegotiation(guestPresent: boolean): Promise<void> {
    if (this.role !== 'Host') {
      throw new WebRtcPeerError('Only the Host can start peer negotiation.')
    }

    if (!this.signaling.isConnected()) {
      throw new WebRtcPeerError('The Room Hub is disconnected.')
    }

    if (!guestPresent) {
      throw new WebRtcPeerError('The Guest must be online before negotiation starts.')
    }

    if (this.negotiationStarted) {
      throw new WebRtcPeerError('Peer negotiation is already active.')
    }

    this.negotiationStarted = true
    const peerConnection = this.ensurePeerConnection()

    if (this.hostVideoTransceiver === null) {
      this.hostVideoTransceiver = peerConnection.addTransceiver('video', {
        direction: 'sendonly',
      })
    }

    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    this.emitStatus()

    const localDescription = peerConnection.localDescription
    if (localDescription?.type !== 'offer' || !localDescription.sdp) {
      throw new WebRtcPeerError('The browser did not produce a valid local Offer.')
    }

    if (!this.signaling.isConnected()) {
      throw new WebRtcPeerError('The Room Hub disconnected during negotiation.')
    }

    await this.signaling.sendOffer(localDescription.sdp)
  }

  public async handleOffer(offer: RoomWebRtcOffer): Promise<void> {
    if (this.role !== 'Guest' || offer.role !== 'Host') {
      throw new WebRtcPeerError('The received Offer is not valid for this participant.')
    }

    if (!this.signaling.isConnected()) {
      throw new WebRtcPeerError('The Room Hub is disconnected.')
    }

    const peerConnection = this.ensurePeerConnection()
    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
    await this.flushPendingRemoteCandidates(peerConnection)
    this.emitStatus()

    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    this.emitStatus()

    const localDescription = peerConnection.localDescription
    if (localDescription?.type !== 'answer' || !localDescription.sdp) {
      throw new WebRtcPeerError('The browser did not produce a valid local Answer.')
    }

    if (!this.signaling.isConnected()) {
      throw new WebRtcPeerError('The Room Hub disconnected during negotiation.')
    }

    await this.signaling.sendAnswer(localDescription.sdp)
  }

  public async handleAnswer(answer: RoomWebRtcAnswer): Promise<void> {
    if (this.role !== 'Host' || answer.role !== 'Guest') {
      throw new WebRtcPeerError('The received Answer is not valid for this participant.')
    }

    const peerConnection = this.peerConnection
    if (peerConnection === null) {
      throw new WebRtcPeerError('There is no Host negotiation for the received Answer.')
    }

    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
    await this.flushPendingRemoteCandidates(peerConnection)
    this.emitStatus()
  }

  public async handleRemoteIceCandidate(signal: RoomIceCandidate): Promise<void> {
    if (signal.role === this.role) {
      throw new WebRtcPeerError('The received ICE candidate has the wrong role.')
    }

    const peerConnection = this.ensurePeerConnection()
    const candidate: RTCIceCandidateInit = {
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
      usernameFragment: signal.usernameFragment,
    }

    if (peerConnection.remoteDescription === null || this.flushingRemoteCandidates) {
      this.pendingRemoteCandidates.push(candidate)
      return
    }

    await peerConnection.addIceCandidate(candidate)
  }

  public close(): void {
    const peerConnection = this.peerConnection

    this.peerConnection = null
    this.hostVideoTransceiver = null
    this.negotiationStarted = false
    this.flushingRemoteCandidates = false
    this.pendingRemoteCandidates.length = 0

    if (peerConnection !== null) {
      peerConnection.onicecandidate = null
      peerConnection.onconnectionstatechange = null
      peerConnection.oniceconnectionstatechange = null
      peerConnection.onicegatheringstatechange = null
      peerConnection.onsignalingstatechange = null
      peerConnection.close()
    }

    this.callbacks.onStatusChanged({
      ...initialPeerConnectionStatus,
      connectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
    })
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.peerConnection !== null) {
      return this.peerConnection
    }

    const peerConnection = this.peerConnectionFactory({ iceServers: [] })
    const emitStatus = () => this.emitStatus()

    peerConnection.onconnectionstatechange = emitStatus
    peerConnection.oniceconnectionstatechange = emitStatus
    peerConnection.onicegatheringstatechange = emitStatus
    peerConnection.onsignalingstatechange = emitStatus
    peerConnection.onicecandidate = (event) => {
      if (event.candidate === null || !this.signaling.isConnected()) {
        return
      }

      void this.signaling
        .sendIceCandidate(event.candidate.toJSON())
        .catch(() => this.callbacks.onSignalSendFailed())
    }

    this.peerConnection = peerConnection
    this.emitStatus()
    return peerConnection
  }

  private async flushPendingRemoteCandidates(
    peerConnection: RTCPeerConnection,
  ): Promise<void> {
    if (peerConnection.remoteDescription === null || this.flushingRemoteCandidates) {
      return
    }

    this.flushingRemoteCandidates = true

    try {
      while (this.pendingRemoteCandidates.length > 0) {
        const candidate = this.pendingRemoteCandidates.shift()
        if (candidate === undefined || this.peerConnection !== peerConnection) {
          return
        }

        await peerConnection.addIceCandidate(candidate)
      }
    } finally {
      this.flushingRemoteCandidates = false
    }
  }

  private emitStatus(): void {
    const peerConnection = this.peerConnection
    if (peerConnection === null) {
      return
    }

    this.callbacks.onStatusChanged({
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      iceGatheringState: peerConnection.iceGatheringState,
      signalingState: peerConnection.signalingState,
    })
  }
}
