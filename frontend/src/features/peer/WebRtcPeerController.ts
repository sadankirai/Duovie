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

export type PeerRecoveryReason = 'connection-failed' | 'connection-closed'

export interface WebRtcPeerCallbacks {
  onStatusChanged: (status: PeerConnectionStatus) => void
  onSignalSendFailed: () => void
  onRecoveryNeeded: (reason: PeerRecoveryReason) => void
}

interface ActivePeer {
  peerConnection: RTCPeerConnection
  generation: number
}

interface PendingRemoteCandidate {
  candidate: RTCIceCandidateInit
  generation: number
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
  private activePeer: ActivePeer | null = null
  private hostVideoTransceiver: RTCRtpTransceiver | null = null
  private readonly pendingRemoteCandidates: PendingRemoteCandidate[] = []
  private flushingGeneration: number | null = null
  private nextGeneration = 0
  private resetRequired = false
  private disposed = false

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

  public get hasActivePeer(): boolean {
    return this.activePeer !== null
  }

  public get requiresResetBeforeRetry(): boolean {
    return this.resetRequired
  }

  public get hostSenderTrackState(): 'not-created' | 'null' | 'attached' {
    if (this.hostVideoTransceiver === null) {
      return 'not-created'
    }

    return this.hostVideoTransceiver.sender.track === null ? 'null' : 'attached'
  }

  public async startHostNegotiation(guestPresent: boolean): Promise<void> {
    this.ensureReadyForAttempt()

    if (this.role !== 'Host') {
      throw new WebRtcPeerError('Only the Host can start peer negotiation.')
    }

    this.ensureHubConnected()

    if (!guestPresent) {
      throw new WebRtcPeerError('The Guest must be online before negotiation starts.')
    }

    if (this.activePeer !== null) {
      throw new WebRtcPeerError('Peer negotiation is already active.')
    }

    const activePeer = this.createPeerConnection()

    try {
      this.hostVideoTransceiver = activePeer.peerConnection.addTransceiver('video', {
        direction: 'sendonly',
      })

      const offer = await activePeer.peerConnection.createOffer()
      this.ensureCurrent(activePeer)
      await activePeer.peerConnection.setLocalDescription(offer)
      this.ensureCurrent(activePeer)
      this.emitStatus(activePeer)

      const localDescription = activePeer.peerConnection.localDescription
      if (localDescription?.type !== 'offer' || !localDescription.sdp) {
        throw new WebRtcPeerError('The browser did not produce a valid local Offer.')
      }

      this.ensureHubConnected()
      await this.signaling.sendOffer(localDescription.sdp)
      this.ensureCurrent(activePeer)
    } catch (error) {
      this.failAttempt(activePeer)
      throw error
    }
  }

  public async handleOffer(offer: RoomWebRtcOffer): Promise<void> {
    this.ensureReadyForAttempt()

    if (this.role !== 'Guest' || offer.role !== 'Host') {
      throw new WebRtcPeerError('The received Offer is not valid for this participant.')
    }

    this.ensureHubConnected()

    const activePeer = this.activePeer ?? this.createPeerConnection()

    try {
      this.ensureInitialSignalingState(activePeer.peerConnection, 'Offer')
      await activePeer.peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
      this.ensureCurrent(activePeer)
      await this.flushPendingRemoteCandidates(activePeer)
      this.ensureCurrent(activePeer)
      this.emitStatus(activePeer)

      const answer = await activePeer.peerConnection.createAnswer()
      this.ensureCurrent(activePeer)
      await activePeer.peerConnection.setLocalDescription(answer)
      this.ensureCurrent(activePeer)
      this.emitStatus(activePeer)

      const localDescription = activePeer.peerConnection.localDescription
      if (localDescription?.type !== 'answer' || !localDescription.sdp) {
        throw new WebRtcPeerError('The browser did not produce a valid local Answer.')
      }

      this.ensureHubConnected()
      await this.signaling.sendAnswer(localDescription.sdp)
      this.ensureCurrent(activePeer)
    } catch (error) {
      this.failAttempt(activePeer)
      throw error
    }
  }

  public async handleAnswer(answer: RoomWebRtcAnswer): Promise<void> {
    this.ensureReadyForAttempt()

    if (this.role !== 'Host' || answer.role !== 'Guest') {
      throw new WebRtcPeerError('The received Answer is not valid for this participant.')
    }

    const activePeer = this.activePeer
    if (activePeer === null) {
      throw new WebRtcPeerError('There is no Host negotiation for the received Answer.')
    }

    const peerConnection = activePeer.peerConnection
    if (
      peerConnection.signalingState !== 'have-local-offer' ||
      peerConnection.localDescription?.type !== 'offer' ||
      peerConnection.remoteDescription !== null
    ) {
      this.failAttempt(activePeer)
      throw new WebRtcPeerError('The received Answer is not valid for the current signaling state.')
    }

    try {
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      this.ensureCurrent(activePeer)
      await this.flushPendingRemoteCandidates(activePeer)
      this.ensureCurrent(activePeer)
      this.emitStatus(activePeer)
    } catch (error) {
      this.failAttempt(activePeer)
      throw error
    }
  }

  public async handleRemoteIceCandidate(signal: RoomIceCandidate): Promise<void> {
    this.ensureReadyForAttempt()

    if (signal.role === this.role) {
      throw new WebRtcPeerError('The received ICE candidate has the wrong role.')
    }

    if (this.role === 'Host' && this.activePeer === null) {
      throw new WebRtcPeerError('There is no Host negotiation for the received ICE candidate.')
    }

    const activePeer = this.activePeer ?? this.createPeerConnection()
    const candidate: RTCIceCandidateInit = {
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
      usernameFragment: signal.usernameFragment,
    }

    if (
      activePeer.peerConnection.remoteDescription === null ||
      this.flushingGeneration === activePeer.generation
    ) {
      this.pendingRemoteCandidates.push({ candidate, generation: activePeer.generation })
      return
    }

    try {
      await activePeer.peerConnection.addIceCandidate(candidate)
      this.ensureCurrent(activePeer)
    } catch (error) {
      this.failAttempt(activePeer)
      throw error
    }
  }

  public resetPeer(): void {
    if (this.disposed) {
      return
    }

    this.releaseActivePeer()
    this.resetRequired = false
    this.emitClosedStatus()
  }

  public close(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.releaseActivePeer()
    this.resetRequired = false
    this.emitClosedStatus()
  }

  private ensureReadyForAttempt(): void {
    if (this.disposed) {
      throw new WebRtcPeerError('The peer controller is closed.')
    }

    if (this.resetRequired) {
      throw new WebRtcPeerError('Reset the peer before retrying negotiation.')
    }
  }

  private ensureHubConnected(): void {
    if (!this.signaling.isConnected()) {
      throw new WebRtcPeerError('The Room Hub is disconnected.')
    }
  }

  private ensureInitialSignalingState(
    peerConnection: RTCPeerConnection,
    descriptionType: string,
  ): void {
    if (
      peerConnection.signalingState !== 'stable' ||
      peerConnection.localDescription !== null ||
      peerConnection.remoteDescription !== null
    ) {
      throw new WebRtcPeerError(
        `The received ${descriptionType} is not valid for the current signaling state.`,
      )
    }
  }

  private createPeerConnection(): ActivePeer {
    const peerConnection = this.peerConnectionFactory({ iceServers: [] })
    const activePeer = { peerConnection, generation: ++this.nextGeneration }
    const emitStatus = () => {
      if (this.isCurrent(activePeer)) {
        this.emitStatus(activePeer)
      }
    }

    peerConnection.onconnectionstatechange = () => {
      if (!this.isCurrent(activePeer)) {
        return
      }

      emitStatus()
      this.handleConnectionStateChange(activePeer)
    }
    peerConnection.oniceconnectionstatechange = () => {
      if (!this.isCurrent(activePeer)) {
        return
      }

      emitStatus()
      if (peerConnection.iceConnectionState === 'failed') {
        this.requireRecovery(activePeer, 'connection-failed')
      }
    }
    peerConnection.onicegatheringstatechange = emitStatus
    peerConnection.onsignalingstatechange = emitStatus
    peerConnection.onicecandidate = (event) => {
      if (
        event.candidate === null ||
        !this.isCurrent(activePeer) ||
        !this.signaling.isConnected()
      ) {
        return
      }

      void this.signaling.sendIceCandidate(event.candidate.toJSON()).catch(() => {
        if (!this.isCurrent(activePeer)) {
          return
        }

        this.failAttempt(activePeer)
        this.callbacks.onSignalSendFailed()
      })
    }

    this.activePeer = activePeer
    this.emitStatus(activePeer)
    return activePeer
  }

  private handleConnectionStateChange(activePeer: ActivePeer): void {
    const connectionState = activePeer.peerConnection.connectionState
    if (connectionState === 'failed') {
      this.requireRecovery(activePeer, 'connection-failed')
    } else if (connectionState === 'closed') {
      this.requireRecovery(activePeer, 'connection-closed')
    }
  }

  private requireRecovery(activePeer: ActivePeer, reason: PeerRecoveryReason): void {
    if (!this.isCurrent(activePeer)) {
      return
    }

    this.resetRequired = true
    this.releaseActivePeer()
    this.callbacks.onRecoveryNeeded(reason)
  }

  private failAttempt(activePeer: ActivePeer): void {
    if (!this.isCurrent(activePeer)) {
      return
    }

    this.resetRequired = true
    this.releaseActivePeer()
    this.emitClosedStatus()
  }

  private releaseActivePeer(): void {
    const activePeer = this.activePeer

    this.activePeer = null
    this.hostVideoTransceiver = null
    this.flushingGeneration = null
    this.pendingRemoteCandidates.length = 0

    if (activePeer === null) {
      return
    }

    const { peerConnection } = activePeer
    peerConnection.onicecandidate = null
    peerConnection.onconnectionstatechange = null
    peerConnection.oniceconnectionstatechange = null
    peerConnection.onicegatheringstatechange = null
    peerConnection.onsignalingstatechange = null
    peerConnection.close()
  }

  private async flushPendingRemoteCandidates(activePeer: ActivePeer): Promise<void> {
    if (
      activePeer.peerConnection.remoteDescription === null ||
      this.flushingGeneration === activePeer.generation
    ) {
      return
    }

    this.flushingGeneration = activePeer.generation

    try {
      while (this.pendingRemoteCandidates.length > 0) {
        const pendingCandidate = this.pendingRemoteCandidates.shift()
        if (pendingCandidate === undefined) {
          return
        }

        this.ensureCurrent(activePeer)
        if (pendingCandidate.generation !== activePeer.generation) {
          continue
        }

        await activePeer.peerConnection.addIceCandidate(pendingCandidate.candidate)
      }
    } finally {
      if (this.flushingGeneration === activePeer.generation) {
        this.flushingGeneration = null
      }
    }
  }

  private ensureCurrent(activePeer: ActivePeer): void {
    if (!this.isCurrent(activePeer)) {
      throw new WebRtcPeerError('The peer negotiation was replaced or reset.')
    }
  }

  private isCurrent(activePeer: ActivePeer): boolean {
    return this.activePeer?.generation === activePeer.generation
  }

  private emitStatus(activePeer: ActivePeer): void {
    if (!this.isCurrent(activePeer)) {
      return
    }

    const { peerConnection } = activePeer
    this.callbacks.onStatusChanged({
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      iceGatheringState: peerConnection.iceGatheringState,
      signalingState: peerConnection.signalingState,
    })
  }

  private emitClosedStatus(): void {
    this.callbacks.onStatusChanged({
      ...initialPeerConnectionStatus,
      connectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
    })
  }
}
