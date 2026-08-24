import {
  initialPeerConnectionStatus,
  type ParticipantRole,
  type PeerConnectionStatus,
  type RoomIceCandidate,
  type RoomScreenShareStateChanged,
  type RoomWebRtcAnswer,
  type RoomWebRtcOffer,
} from './contracts'
import {
  computeQualitySnapshot,
  type PreviousQualitySample,
  type QualitySnapshot,
} from './qualitySnapshot'
import { applyMotionOptimizedSenderProfile } from './screenShareEncoding'

export interface PeerSignaling {
  isConnected: () => boolean
  sendOffer: (sdp: string) => Promise<void>
  sendAnswer: (sdp: string) => Promise<void>
  sendIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
  requestPeerRecovery: () => Promise<void>
  sendScreenShareState: (active: boolean) => Promise<void>
}

export type PeerConnectionFactory = (configuration: RTCConfiguration) => RTCPeerConnection
export type DisplayMediaProvider = (
  constraints: DisplayMediaStreamOptions,
) => Promise<MediaStream>
export type RemoteMediaStreamFactory = (tracks: MediaStreamTrack[]) => MediaStream

export type PeerRecoveryReason = 'connection-failed' | 'connection-closed'
export type ScreenShareState = 'inactive' | 'requesting' | 'active'
export type RemoteVideoState = 'unavailable' | 'waiting' | 'receiving'

export interface WebRtcPeerCallbacks {
  onStatusChanged: (status: PeerConnectionStatus) => void
  onSignalSendFailed: () => void
  onRecoveryNeeded: (reason: PeerRecoveryReason) => void
  onScreenShareStateChanged: (state: ScreenShareState) => void
  onRemoteVideoChanged: (stream: MediaStream | null, state: RemoteVideoState) => void
  onHostScreenShareChanged: (active: boolean) => void
  onMediaOperationFailed: () => void
}

interface ActivePeer {
  peerConnection: RTCPeerConnection
  generation: number
}

interface HostVideoTransceiverOwner {
  transceiver: RTCRtpTransceiver
  generation: number
}

interface PendingRemoteCandidate {
  candidate: RTCIceCandidateInit
  generation: number
}

interface LocalDisplayShare {
  activePeer: ActivePeer
  requestId: number
  sender: RTCRtpSender
  track: MediaStreamTrack
}

interface RemoteVideoOwner {
  activePeer: ActivePeer
  stream: MediaStream
  track: MediaStreamTrack
}

const screenCaptureFailureMessage = 'Screen capture could not be started.'
const screenStopFailureMessage = 'Screen sharing could not be stopped cleanly.'

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
  private readonly iceServers: readonly RTCIceServer[]
  private readonly iceTransportPolicy: RTCIceTransportPolicy
  private readonly peerConnectionFactory: PeerConnectionFactory
  private readonly displayMediaProvider: DisplayMediaProvider
  private readonly remoteMediaStreamFactory: RemoteMediaStreamFactory
  private activePeer: ActivePeer | null = null
  private hostVideoTransceiverOwner: HostVideoTransceiverOwner | null = null
  private readonly pendingRemoteCandidates: PendingRemoteCandidate[] = []
  private flushingGeneration: number | null = null
  private nextGeneration = 0
  private resetRequired = false
  private disposed = false
  private screenShareStateValue: ScreenShareState = 'inactive'
  private captureRequestId = 0
  private displayMediaRequestInFlight = false
  private localDisplayShare: LocalDisplayShare | null = null
  private stopScreenSharePromise: Promise<void> | null = null
  private remoteVideoOwner: RemoteVideoOwner | null = null
  private hostScreenShareActiveValue = false
  private qualitySample: PreviousQualitySample | null = null

  public constructor(
    role: ParticipantRole,
    signaling: PeerSignaling,
    callbacks: WebRtcPeerCallbacks,
    iceServers: readonly RTCIceServer[] = [],
    iceTransportPolicy: RTCIceTransportPolicy = 'all',
    peerConnectionFactory: PeerConnectionFactory = (configuration) =>
      new RTCPeerConnection(configuration),
    displayMediaProvider: DisplayMediaProvider = requestDisplayMedia,
    remoteMediaStreamFactory: RemoteMediaStreamFactory = (tracks) =>
      new MediaStream(tracks),
  ) {
    this.role = role
    this.signaling = signaling
    this.callbacks = callbacks
    this.iceServers = iceServers
    this.iceTransportPolicy = iceTransportPolicy
    this.peerConnectionFactory = peerConnectionFactory
    this.displayMediaProvider = displayMediaProvider
    this.remoteMediaStreamFactory = remoteMediaStreamFactory
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

  public get screenShareState(): ScreenShareState {
    return this.screenShareStateValue
  }

  public get hasPendingDisplayCaptureRequest(): boolean {
    return this.displayMediaRequestInFlight
  }

  public get hostScreenShareActive(): boolean {
    return this.hostScreenShareActiveValue
  }

  public get hostSenderTrackState(): 'not-created' | 'null' | 'attached' {
    const transceiver = this.hostVideoTransceiverOwner?.transceiver
    if (transceiver === undefined) {
      return 'not-created'
    }

    return transceiver.sender.track === null ? 'null' : 'attached'
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
      const transceiver = activePeer.peerConnection.addTransceiver('video', {
        direction: 'sendonly',
      })
      this.hostVideoTransceiverOwner = {
        transceiver,
        generation: activePeer.generation,
      }

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

  public handleScreenShareStateChanged(state: RoomScreenShareStateChanged): void {
    if (this.disposed) {
      return
    }

    if (this.role !== 'Guest' || state.role !== 'Host') {
      throw new WebRtcPeerError('The received screen-share state is not valid for this participant.')
    }

    if (state.active && this.activePeer === null) {
      return
    }

    this.setHostScreenShareActive(state.active)
  }

  public async startScreenShare(): Promise<void> {
    this.ensureReadyForAttempt()

    if (this.role !== 'Host') {
      throw new WebRtcPeerError('Only the Host can share a screen.')
    }

    this.ensureHubConnected()

    if (this.screenShareStateValue !== 'inactive' || this.displayMediaRequestInFlight) {
      throw new WebRtcPeerError('Screen sharing is already active or requesting permission.')
    }

    const activePeer = this.activePeer
    const transceiverOwner = this.hostVideoTransceiverOwner
    if (
      activePeer === null ||
      transceiverOwner === null ||
      transceiverOwner.generation !== activePeer.generation
    ) {
      throw new WebRtcPeerError('A connected Host peer is required before screen sharing.')
    }

    const peerConnection = activePeer.peerConnection
    const sender = transceiverOwner.transceiver.sender
    if (
      peerConnection.connectionState !== 'connected' ||
      peerConnection.signalingState !== 'stable' ||
      sender.track !== null
    ) {
      throw new WebRtcPeerError('A stable connected Host peer is required before screen sharing.')
    }

    const requestId = ++this.captureRequestId
    this.displayMediaRequestInFlight = true
    this.setScreenShareState('requesting')

    let stream: MediaStream
    try {
      stream = await this.displayMediaProvider({ video: true, audio: false })
    } catch {
      if (this.isCaptureRequestCurrent(activePeer, sender, requestId)) {
        this.setScreenShareState('inactive')
      }

      throw new WebRtcPeerError(screenCaptureFailureMessage)
    } finally {
      this.displayMediaRequestInFlight = false
    }

    const tracks = stream.getTracks()
    const usableVideoTracks = tracks.filter(
      (track) => track.kind === 'video' && track.readyState !== 'ended',
    )

    if (usableVideoTracks.length !== 1) {
      stopTracks(tracks)
      if (this.isCaptureRequestCurrent(activePeer, sender, requestId)) {
        this.setScreenShareState('inactive')
      }

      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }

    const videoTrack = usableVideoTracks[0]
    stopTracks(tracks.filter((track) => track !== videoTrack))

    if (!this.isCaptureRequestCurrent(activePeer, sender, requestId)) {
      stopTrack(videoTrack)
      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }

    const share: LocalDisplayShare = {
      activePeer,
      requestId,
      sender,
      track: videoTrack,
    }
    this.localDisplayShare = share
    videoTrack.onended = () => {
      void this.handleLocalDisplayTrackEnded(share)
    }

    try {
      await sender.replaceTrack(videoTrack)
    } catch {
      this.clearFailedDisplayShare(share)
      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }

    // Best-effort motion-oriented encoding profile (content hint, resolution/framerate/
    // bitrate/degradation preference on the sender only). Never renegotiates and never
    // fails the share; see applyMotionOptimizedSenderProfile for failure handling.
    await applyMotionOptimizedSenderProfile(sender, videoTrack)

    if (
      !this.isCaptureRequestCurrent(activePeer, sender, requestId) ||
      this.localDisplayShare !== share ||
      videoTrack.readyState === 'ended'
    ) {
      this.clearFailedDisplayShare(share)
      if (this.isCurrent(activePeer)) {
        await attemptReplaceTrack(sender, null).catch(() => undefined)
      }
      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }

    this.setScreenShareState('active')

    try {
      await this.signaling.sendScreenShareState(true)
    } catch {
      await this.rollbackDisplayShareAfterActiveSignalFailure(share)
      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }

    if (!this.isDisplayShareCurrent(share)) {
      throw new WebRtcPeerError(screenCaptureFailureMessage)
    }
  }

  public async stopScreenShare(): Promise<void> {
    if (this.role !== 'Host') {
      throw new WebRtcPeerError('Only the Host can stop screen sharing.')
    }

    if (this.stopScreenSharePromise !== null) {
      return this.stopScreenSharePromise
    }

    const operation = this.performStopScreenShare()
    this.stopScreenSharePromise = operation

    try {
      await operation
    } finally {
      if (this.stopScreenSharePromise === operation) {
        this.stopScreenSharePromise = null
      }
    }
  }

  /**
   * Best-effort WebRTC quality telemetry for the current peer, or `null` when there is no
   * active peer. Never throws: a `getStats()` failure or a peer replaced/closed while the
   * call was in flight both safely resolve to `null` rather than affecting peer health,
   * renegotiation, or capture. Never exposes IP addresses, raw ICE candidates, TURN
   * credentials, or raw SDP — see {@link computeQualitySnapshot}.
   */
  public async getQualitySnapshot(): Promise<QualitySnapshot | null> {
    const activePeer = this.activePeer
    if (activePeer === null) {
      return null
    }

    let report: RTCStatsReport
    try {
      report = await activePeer.peerConnection.getStats()
    } catch {
      return null
    }

    if (!this.isCurrent(activePeer)) {
      return null
    }

    const captureSettings =
      typeof this.localDisplayShare?.track.getSettings === 'function'
        ? this.localDisplayShare.track.getSettings()
        : null

    const { snapshot, nextSample } = computeQualitySnapshot({
      report,
      connectionState: activePeer.peerConnection.connectionState,
      iceConnectionState: activePeer.peerConnection.iceConnectionState,
      signalingState: activePeer.peerConnection.signalingState,
      nowMs: Date.now(),
      previousSample: this.qualitySample,
      captureWidth: captureSettings?.width ?? null,
      captureHeight: captureSettings?.height ?? null,
    })
    this.qualitySample = nextSample
    return snapshot
  }

  public resetPeer(notifyRemote = true): void {
    if (this.disposed) {
      return
    }

    this.releaseActivePeer(notifyRemote)
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
    const peerConnection = this.peerConnectionFactory({
      iceServers: [...this.iceServers],
      iceTransportPolicy: this.iceTransportPolicy,
    })
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
    peerConnection.ontrack = (event) => {
      this.handleRemoteTrack(activePeer, event)
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

  private releaseActivePeer(notifyRemote = true): void {
    const activePeer = this.activePeer

    this.stopScreenSharePromise = null
    this.invalidateAndStopLocalCapture(notifyRemote)
    this.clearRemoteVideo()
    this.setHostScreenShareActive(false)
    this.activePeer = null
    this.hostVideoTransceiverOwner = null
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
    peerConnection.ontrack = null
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

  private isCaptureRequestCurrent(
    activePeer: ActivePeer,
    sender: RTCRtpSender,
    requestId: number,
  ): boolean {
    return (
      !this.disposed &&
      !this.resetRequired &&
      this.captureRequestId === requestId &&
      this.screenShareStateValue === 'requesting' &&
      this.isCurrent(activePeer) &&
      this.hostVideoTransceiverOwner?.generation === activePeer.generation &&
      this.hostVideoTransceiverOwner.transceiver.sender === sender
    )
  }

  private clearFailedDisplayShare(share: LocalDisplayShare): void {
    if (this.localDisplayShare === share) {
      this.localDisplayShare = null
    }

    share.track.onended = null
    stopTrack(share.track)
    if (this.captureRequestId === share.requestId) {
      this.setScreenShareState('inactive')
    }
  }

  private isDisplayShareCurrent(share: LocalDisplayShare): boolean {
    return (
      !this.disposed &&
      !this.resetRequired &&
      this.localDisplayShare === share &&
      this.screenShareStateValue === 'active' &&
      this.isCurrent(share.activePeer) &&
      this.hostVideoTransceiverOwner?.generation === share.activePeer.generation &&
      this.hostVideoTransceiverOwner.transceiver.sender === share.sender &&
      share.sender.track === share.track &&
      share.track.readyState !== 'ended'
    )
  }

  private async rollbackDisplayShareAfterActiveSignalFailure(
    share: LocalDisplayShare,
  ): Promise<void> {
    if (this.localDisplayShare !== share) {
      return
    }

    this.localDisplayShare = null
    share.track.onended = null
    ++this.captureRequestId
    const shouldDetach =
      this.isCurrent(share.activePeer) &&
      this.hostVideoTransceiverOwner?.generation === share.activePeer.generation &&
      this.hostVideoTransceiverOwner.transceiver.sender === share.sender
    const detachPromise = shouldDetach
      ? attemptReplaceTrack(share.sender, null)
      : Promise.resolve()
    stopTrack(share.track)
    await detachPromise.catch(() => undefined)
    this.setScreenShareState('inactive')
    await this.sendInactiveScreenShareState().catch(() => undefined)
  }

  private async performStopScreenShare(): Promise<void> {
    if (this.screenShareStateValue === 'inactive') {
      return
    }

    const wasActive = this.screenShareStateValue === 'active'
    const stopRequestId = ++this.captureRequestId
    const share = this.localDisplayShare
    this.localDisplayShare = null

    if (share === null) {
      this.setScreenShareState('inactive')
      return
    }

    share.track.onended = null
    const shouldDetach =
      this.isCurrent(share.activePeer) &&
      this.hostVideoTransceiverOwner?.generation === share.activePeer.generation &&
      this.hostVideoTransceiverOwner.transceiver.sender === share.sender
    const detachPromise = shouldDetach
      ? attemptReplaceTrack(share.sender, null)
      : Promise.resolve()
    stopTrack(share.track)

    let detachFailed = false
    try {
      await detachPromise
    } catch {
      detachFailed = true
    }

    if (this.captureRequestId === stopRequestId) {
      this.setScreenShareState('inactive')
    }

    const stateSendFailed = wasActive
      ? await this.sendInactiveScreenShareState()
      : false

    if (detachFailed || stateSendFailed) {
      throw new WebRtcPeerError(screenStopFailureMessage)
    }
  }

  private async handleLocalDisplayTrackEnded(share: LocalDisplayShare): Promise<void> {
    if (this.localDisplayShare !== share) {
      return
    }

    const wasActive = this.screenShareStateValue === 'active'
    this.localDisplayShare = null
    share.track.onended = null
    const endRequestId = ++this.captureRequestId
    const shouldDetach =
      this.isCurrent(share.activePeer) &&
      this.hostVideoTransceiverOwner?.generation === share.activePeer.generation &&
      this.hostVideoTransceiverOwner.transceiver.sender === share.sender
    const detachPromise = shouldDetach
      ? attemptReplaceTrack(share.sender, null)
      : Promise.resolve()
    stopTrack(share.track)

    let detachFailed = false
    try {
      await detachPromise
    } catch {
      detachFailed = true
    }

    if (this.captureRequestId !== endRequestId) {
      return
    }

    this.setScreenShareState('inactive')
    const stateSendFailed = wasActive
      ? await this.sendInactiveScreenShareState()
      : false
    if (detachFailed || stateSendFailed) {
      this.callbacks.onMediaOperationFailed()
    }
  }

  private invalidateAndStopLocalCapture(notifyRemote: boolean): void {
    const wasActive = this.screenShareStateValue === 'active'
    ++this.captureRequestId
    const share = this.localDisplayShare
    this.localDisplayShare = null

    if (share !== null) {
      share.track.onended = null
      void attemptReplaceTrack(share.sender, null).catch(() => undefined)
      stopTrack(share.track)
    }

    this.setScreenShareState('inactive')
    if (wasActive && notifyRemote) {
      void this.sendInactiveScreenShareState().then((failed) => {
        if (failed) {
          this.callbacks.onMediaOperationFailed()
        }
      })
    }
  }

  private async sendInactiveScreenShareState(): Promise<boolean> {
    if (this.role !== 'Host' || !this.signaling.isConnected()) {
      return false
    }

    try {
      await this.signaling.sendScreenShareState(false)
      return false
    } catch {
      return true
    }
  }

  private handleRemoteTrack(activePeer: ActivePeer, event: RTCTrackEvent): void {
    if (
      this.role !== 'Guest' ||
      !this.isCurrent(activePeer) ||
      event.track.kind !== 'video' ||
      event.track.readyState === 'ended'
    ) {
      return
    }

    if (this.remoteVideoOwner !== null) {
      return
    }

    let stream: MediaStream
    try {
      stream = this.remoteMediaStreamFactory([event.track])
    } catch {
      this.callbacks.onMediaOperationFailed()
      return
    }

    const remoteVideoOwner: RemoteVideoOwner = {
      activePeer,
      stream,
      track: event.track,
    }
    this.remoteVideoOwner = remoteVideoOwner
    event.track.onmute = () => {
      if (this.isRemoteVideoCurrent(remoteVideoOwner)) {
        this.callbacks.onRemoteVideoChanged(stream, 'waiting')
      }
    }
    event.track.onunmute = () => {
      if (this.isRemoteVideoCurrent(remoteVideoOwner)) {
        this.callbacks.onRemoteVideoChanged(stream, 'receiving')
      }
    }
    event.track.onended = () => {
      if (!this.isRemoteVideoCurrent(remoteVideoOwner)) {
        return
      }

      this.clearRemoteVideo()
    }

    this.callbacks.onRemoteVideoChanged(
      stream,
      event.track.muted ? 'waiting' : 'receiving',
    )
  }

  private isRemoteVideoCurrent(remoteVideoOwner: RemoteVideoOwner): boolean {
    return (
      this.remoteVideoOwner === remoteVideoOwner &&
      this.isCurrent(remoteVideoOwner.activePeer)
    )
  }

  private clearRemoteVideo(): void {
    const remoteVideoOwner = this.remoteVideoOwner
    if (remoteVideoOwner === null) {
      return
    }

    this.remoteVideoOwner = null
    remoteVideoOwner.track.onmute = null
    remoteVideoOwner.track.onunmute = null
    remoteVideoOwner.track.onended = null
    this.callbacks.onRemoteVideoChanged(null, 'unavailable')
  }

  private setHostScreenShareActive(active: boolean): void {
    if (this.hostScreenShareActiveValue === active) {
      return
    }

    this.hostScreenShareActiveValue = active
    this.callbacks.onHostScreenShareChanged(active)
  }

  private setScreenShareState(state: ScreenShareState): void {
    if (this.screenShareStateValue === state) {
      return
    }

    this.screenShareStateValue = state
    this.callbacks.onScreenShareStateChanged(state)
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

async function requestDisplayMedia(
  constraints: DisplayMediaStreamOptions,
): Promise<MediaStream> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.getDisplayMedia !== 'function'
  ) {
    throw new WebRtcPeerError(screenCaptureFailureMessage)
  }

  return navigator.mediaDevices.getDisplayMedia(constraints)
}

function stopTracks(tracks: MediaStreamTrack[]): void {
  for (const track of tracks) {
    stopTrack(track)
  }
}

function attemptReplaceTrack(
  sender: RTCRtpSender,
  track: MediaStreamTrack | null,
): Promise<void> {
  try {
    return sender.replaceTrack(track)
  } catch {
    return Promise.reject()
  }
}

function stopTrack(track: MediaStreamTrack): void {
  try {
    track.stop()
  } catch {
    // Capture cleanup is best-effort and must not expose browser details.
  }
}
