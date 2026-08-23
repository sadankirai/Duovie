import {
  initialPeerConnectionStatus,
  type ParticipantRole,
  type PeerConnectionStatus,
  type RoomIceCandidate,
  type RoomPresenceParticipant,
  type RoomPresenceSnapshot,
  type RoomScreenShareStateChanged,
  type RoomSession,
  type RoomWebRtcAnswer,
  type RoomWebRtcOffer,
  type RoomWebRtcRecoveryRequested,
} from './contracts'
import { RoomHubClient, type RoomHubHandlers } from './RoomHubClient'
import {
  WebRtcPeerController,
  type PeerSignaling,
  type RemoteVideoState,
  type ScreenShareState,
  type WebRtcPeerCallbacks,
} from './WebRtcPeerController'

export type HubStatus = 'disconnected' | 'connecting' | 'connected'
export type RoomRuntimeStatus =
  | 'waiting-for-counterpart'
  | 'negotiating'
  | 'connected'
  | 'recovering'
  | 'unavailable'

export interface RoomRuntimeSnapshot {
  hubStatus: HubStatus
  runtimeStatus: RoomRuntimeStatus
  presence: RoomPresenceParticipant[]
  peerStatus: PeerConnectionStatus
  peerActive: boolean
  hostSenderTrackState: 'not-created' | 'null' | 'attached'
  screenShareState: ScreenShareState
  displayCaptureRequestPending: boolean
  remoteVideoState: RemoteVideoState
  hostScreenShareActive: boolean
}

export interface RoomRuntimeCallbacks {
  onStateChanged: (snapshot: RoomRuntimeSnapshot) => void
  onRemoteVideoChanged: (stream: MediaStream | null, state: RemoteVideoState) => void
  onNotice: (message: string) => void
}

export interface RoomHubRuntime extends PeerSignaling {
  start: () => Promise<void>
  stop: () => Promise<void>
  disconnect: () => Promise<void>
}

export interface RoomPeerRuntime {
  readonly hasActivePeer: boolean
  readonly requiresResetBeforeRetry: boolean
  readonly screenShareState: ScreenShareState
  readonly hasPendingDisplayCaptureRequest: boolean
  readonly hostScreenShareActive: boolean
  readonly hostSenderTrackState: 'not-created' | 'null' | 'attached'
  startHostNegotiation: (guestPresent: boolean) => Promise<void>
  handleOffer: (offer: RoomWebRtcOffer) => Promise<void>
  handleAnswer: (answer: RoomWebRtcAnswer) => Promise<void>
  handleRemoteIceCandidate: (candidate: RoomIceCandidate) => Promise<void>
  handleScreenShareStateChanged: (state: RoomScreenShareStateChanged) => void
  startScreenShare: () => Promise<void>
  stopScreenShare: () => Promise<void>
  resetPeer: (notifyRemote?: boolean) => void
  close: () => void
}

export type CancelScheduledWork = () => void

export interface RoomRuntimeDependencies {
  createHubClient: (
    session: RoomSession,
    handlers: RoomHubHandlers,
  ) => RoomHubRuntime
  createPeerController: (
    role: ParticipantRole,
    signaling: PeerSignaling,
    callbacks: WebRtcPeerCallbacks,
  ) => RoomPeerRuntime
  schedule: (callback: () => void, delayMilliseconds: number) => CancelScheduledWork
  retryDelaysMilliseconds: readonly number[]
  hubReconnectDelaysMilliseconds: readonly number[]
}

const closedPeerStatus: PeerConnectionStatus = {
  connectionState: 'closed',
  iceConnectionState: 'closed',
  iceGatheringState: 'complete',
  signalingState: 'closed',
}

export const initialRoomRuntimeSnapshot: RoomRuntimeSnapshot = {
  hubStatus: 'disconnected',
  runtimeStatus: 'waiting-for-counterpart',
  presence: [],
  peerStatus: initialPeerConnectionStatus,
  peerActive: false,
  hostSenderTrackState: 'not-created',
  screenShareState: 'inactive',
  displayCaptureRequestPending: false,
  remoteVideoState: 'unavailable',
  hostScreenShareActive: false,
}

export const defaultRoomRuntimeDependencies: RoomRuntimeDependencies = {
  createHubClient: (session, handlers) => new RoomHubClient(session, handlers),
  createPeerController: (role, signaling, callbacks) =>
    new WebRtcPeerController(role, signaling, callbacks),
  schedule: (callback, delayMilliseconds) => {
    const timer = window.setTimeout(callback, delayMilliseconds)
    return () => window.clearTimeout(timer)
  },
  retryDelaysMilliseconds: [0, 300, 1_000],
  hubReconnectDelaysMilliseconds: [1_000, 3_000, 8_000],
}

export class RoomRuntime {
  private readonly session: RoomSession
  private readonly callbacks: RoomRuntimeCallbacks
  private readonly dependencies: RoomRuntimeDependencies
  private hub: RoomHubRuntime | null = null
  private peer: RoomPeerRuntime | null = null
  private disposed = false
  private hubGeneration = 0
  private peerGeneration = 0
  private recoveryGeneration = 0
  private cancelScheduledRecovery: CancelScheduledWork | null = null
  private retryIndex = 0
  private recoveryEpisode = false
  private cancelScheduledHubReconnect: CancelScheduledWork | null = null
  private hubRetryIndex = 0
  private snapshot: RoomRuntimeSnapshot = {
    ...initialRoomRuntimeSnapshot,
    presence: [],
    peerStatus: { ...initialPeerConnectionStatus },
  }

  public constructor(
    session: RoomSession,
    callbacks: RoomRuntimeCallbacks,
    dependencies: RoomRuntimeDependencies = defaultRoomRuntimeDependencies,
  ) {
    this.session = session
    this.callbacks = callbacks
    this.dependencies = dependencies
  }

  public get state(): RoomRuntimeSnapshot {
    return this.copySnapshot()
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error('The Room runtime is closed.')
    }

    if (this.hub !== null) {
      return
    }

    const generation = ++this.hubGeneration
    let hub: RoomHubRuntime | null = null
    const isCurrentHub = () =>
      !this.disposed &&
      hub !== null &&
      this.hub === hub &&
      this.hubGeneration === generation
    const handlers: RoomHubHandlers = {
      onPresenceSnapshot: (presence) => {
        if (isCurrentHub()) {
          this.handlePresenceSnapshot(presence)
        }
      },
      onPresenceChanged: (participant) => {
        if (isCurrentHub()) {
          this.handlePresenceChanged(participant)
        }
      },
      onWebRtcOffer: (offer) => {
        if (isCurrentHub()) {
          void this.handleOffer(offer)
        }
      },
      onWebRtcAnswer: (answer) => {
        if (isCurrentHub()) {
          void this.handleAnswer(answer)
        }
      },
      onIceCandidate: (candidate) => {
        if (isCurrentHub()) {
          void this.handleIceCandidate(candidate)
        }
      },
      onWebRtcRecoveryRequested: (request) => {
        if (isCurrentHub()) {
          this.handleRecoveryRequested(request)
        }
      },
      onScreenShareStateChanged: (state) => {
        if (isCurrentHub()) {
          this.peer?.handleScreenShareStateChanged(state)
        }
      },
      onDisconnected: () => {
        if (isCurrentHub()) {
          this.handleUnexpectedHubDisconnect()
        }
      },
    }

    hub = this.dependencies.createHubClient(this.session, handlers)
    this.hub = hub
    this.update({ hubStatus: 'connecting' })

    try {
      await hub.start()
    } catch (error) {
      if (isCurrentHub()) {
        this.handleHubDisconnected()
      }
      throw error
    }

    if (!isCurrentHub()) {
      await hub.stop().catch(() => undefined)
      return
    }

    this.update({ hubStatus: 'connected' })
    this.reconcileCounterpart()
  }

  public async stop(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    ++this.hubGeneration
    this.cancelRecovery()
    this.cancelHubReconnect()
    this.disposePeer(true)
    const hub = this.hub
    this.hub = null
    this.update({
      hubStatus: 'disconnected',
      runtimeStatus: 'unavailable',
      presence: [],
    })

    if (hub !== null) {
      await hub.stop().catch(() => undefined)
    }
  }

  public async disconnectHubForDiagnostics(): Promise<void> {
    await this.hub?.disconnect()
  }

  public async reconnectHubForDiagnostics(): Promise<void> {
    const hub = this.hub
    if (this.disposed || hub === null || hub.isConnected()) {
      return
    }

    this.cancelHubReconnect()
    const generation = this.hubGeneration
    this.update({ hubStatus: 'connecting' })
    try {
      await hub.start()
      if (
        this.disposed ||
        this.hub !== hub ||
        this.hubGeneration !== generation
      ) {
        await hub.stop().catch(() => undefined)
        return
      }

      this.hubRetryIndex = 0
      this.resetFailureEpisode()
      this.update({ hubStatus: 'connected', runtimeStatus: 'waiting-for-counterpart' })
      this.reconcileCounterpart()
    } catch {
      if (this.hub === hub && this.hubGeneration === generation) {
        this.handleHubDisconnected()
      }
      throw new Error('The Room Hub could not reconnect.')
    }
  }

  public restartPeerForDiagnostics(): void {
    if (this.disposed || !this.isCounterpartOnline()) {
      return
    }

    this.disposePeer(true)
    this.resetFailureEpisode()
    this.recoveryEpisode = true
    this.update({ runtimeStatus: 'recovering' })
    this.scheduleRecovery()
  }

  public async startScreenShare(): Promise<void> {
    const peer = this.peer
    if (this.session.role !== 'Host' || peer === null) {
      throw new Error('A connected Host peer is required before screen sharing.')
    }

    await peer.startScreenShare()
  }

  public async stopScreenShare(): Promise<void> {
    if (this.session.role !== 'Host') {
      throw new Error('Only the Host can stop screen sharing.')
    }

    await this.peer?.stopScreenShare()
  }

  private handlePresenceSnapshot(snapshot: RoomPresenceSnapshot): void {
    const wasOnline = this.isCounterpartOnline()
    this.update({ presence: snapshot.participants.filter((participant) => participant.connected) })
    this.handleCounterpartTransition(wasOnline)
  }

  private handlePresenceChanged(participant: RoomPresenceParticipant): void {
    const wasOnline = this.isCounterpartOnline()
    const withoutParticipant = this.snapshot.presence.filter(
      (current) => current.participantId !== participant.participantId,
    )
    const presence = participant.connected
      ? [...withoutParticipant, participant]
      : withoutParticipant
    this.update({ presence })
    this.handleCounterpartTransition(wasOnline)
  }

  private handleCounterpartTransition(wasOnline: boolean): void {
    const isOnline = this.isCounterpartOnline()
    if (!isOnline) {
      if (wasOnline || this.peer !== null || this.cancelScheduledRecovery !== null) {
        this.cancelRecovery()
        this.retryIndex = 0
        this.recoveryEpisode = false
        this.disposePeer(false)
      }

      this.update({ runtimeStatus: 'waiting-for-counterpart' })
      return
    }

    if (!wasOnline) {
      this.resetFailureEpisode()
      this.update({ runtimeStatus: 'waiting-for-counterpart' })
    }

    this.reconcileCounterpart()
  }

  private reconcileCounterpart(): void {
    if (
      this.disposed ||
      this.hub === null ||
      !this.hub.isConnected() ||
      !this.isCounterpartOnline() ||
      this.snapshot.runtimeStatus === 'unavailable'
    ) {
      return
    }

    if (this.session.role === 'Host') {
      void this.ensureHostNegotiation()
    } else if (this.peer === null && !this.recoveryEpisode) {
      this.update({ runtimeStatus: 'waiting-for-counterpart' })
    }
  }

  private async ensureHostNegotiation(): Promise<void> {
    if (
      this.disposed ||
      this.session.role !== 'Host' ||
      this.peer !== null ||
      this.cancelScheduledRecovery !== null ||
      this.hub === null ||
      !this.hub.isConnected() ||
      !this.isCounterpartOnline()
    ) {
      return
    }

    let peer: RoomPeerRuntime
    try {
      peer = this.createPeer()
      this.update({
        runtimeStatus: this.recoveryEpisode ? 'recovering' : 'negotiating',
      })
      await peer.startHostNegotiation(true)
    } catch {
      if (this.peer !== null) {
        this.handlePeerFailure(this.peer)
      } else {
        this.update({ runtimeStatus: 'unavailable' })
      }
    }
  }

  private async handleOffer(offer: RoomWebRtcOffer): Promise<void> {
    if (this.session.role !== 'Guest' || offer.role !== 'Host') {
      return
    }

    this.cancelRecovery()
    if (this.peer !== null && this.snapshot.runtimeStatus !== 'negotiating') {
      this.disposePeer(false)
    }

    let peer: RoomPeerRuntime
    try {
      peer = this.peer ?? this.createPeer()
      this.update({
        runtimeStatus: this.recoveryEpisode ? 'recovering' : 'negotiating',
      })
      await peer.handleOffer(offer)
    } catch {
      if (this.peer !== null) {
        this.handlePeerFailure(this.peer)
      } else {
        this.update({ runtimeStatus: 'unavailable' })
      }
    }
  }

  private async handleAnswer(answer: RoomWebRtcAnswer): Promise<void> {
    const peer = this.peer
    if (this.session.role !== 'Host' || answer.role !== 'Guest' || peer === null) {
      return
    }

    try {
      await peer.handleAnswer(answer)
    } catch {
      this.handlePeerFailure(peer)
    }
  }

  private async handleIceCandidate(candidate: RoomIceCandidate): Promise<void> {
    if (candidate.role === this.session.role) {
      return
    }

    let peer = this.peer
    if (peer === null && this.session.role === 'Guest') {
      try {
        peer = this.createPeer()
        this.update({
          runtimeStatus: this.recoveryEpisode ? 'recovering' : 'negotiating',
        })
      } catch {
        this.update({ runtimeStatus: 'unavailable' })
        return
      }
    }

    if (peer === null) {
      return
    }

    try {
      await peer.handleRemoteIceCandidate(candidate)
    } catch {
      this.handlePeerFailure(peer)
    }
  }

  private handleRecoveryRequested(request: RoomWebRtcRecoveryRequested): void {
    if (request.role === this.session.role || !this.isCounterpartOnline()) {
      return
    }

    if (this.snapshot.runtimeStatus === 'recovering') {
      return
    }

    this.disposePeer(false)
    this.resetFailureEpisode()
    this.recoveryEpisode = true
    this.update({ runtimeStatus: 'recovering' })

    if (this.session.role === 'Host') {
      this.scheduleRecovery()
    }
  }

  private handlePeerFailure(peer: RoomPeerRuntime): void {
    if (this.peer !== peer || this.disposed) {
      return
    }

    this.disposePeer(false)
    this.recoveryEpisode = true
    this.update({ runtimeStatus: 'recovering' })
    this.scheduleRecovery()
  }

  private scheduleRecovery(): void {
    if (
      this.disposed ||
      this.cancelScheduledRecovery !== null ||
      !this.isCounterpartOnline() ||
      this.hub === null ||
      !this.hub.isConnected()
    ) {
      return
    }

    const delay = this.dependencies.retryDelaysMilliseconds[this.retryIndex]
    if (delay === undefined) {
      this.update({ runtimeStatus: 'unavailable' })
      return
    }

    this.retryIndex += 1
    const generation = ++this.recoveryGeneration
    this.cancelScheduledRecovery = this.dependencies.schedule(() => {
      this.cancelScheduledRecovery = null
      void this.runRecovery(generation)
    }, delay)
  }

  private async runRecovery(generation: number): Promise<void> {
    const hub = this.hub
    if (
      this.disposed ||
      generation !== this.recoveryGeneration ||
      hub === null ||
      !hub.isConnected() ||
      !this.isCounterpartOnline() ||
      this.peer !== null
    ) {
      return
    }

    await hub.requestPeerRecovery().catch(() => undefined)
    if (
      this.disposed ||
      generation !== this.recoveryGeneration ||
      this.hub !== hub ||
      !hub.isConnected() ||
      !this.isCounterpartOnline() ||
      this.peer !== null
    ) {
      return
    }

    if (this.session.role === 'Host') {
      await this.ensureHostNegotiation()
    } else {
      this.scheduleRecovery()
    }
  }

  private createPeer(): RoomPeerRuntime {
    const hub = this.hub
    if (hub === null) {
      throw new Error('The Room Hub is unavailable.')
    }

    const generation = ++this.peerGeneration
    let peer: RoomPeerRuntime | null = null
    const isCurrentPeer = () =>
      !this.disposed &&
      peer !== null &&
      this.peer === peer &&
      this.peerGeneration === generation
    const callbacks: WebRtcPeerCallbacks = {
      onStatusChanged: (status) => {
        if (!isCurrentPeer()) {
          return
        }

        this.snapshot.peerStatus = status
        this.refreshPeerProjection(peer!)
        if (
          status.connectionState === 'connected' &&
          status.iceConnectionState === 'connected' &&
          status.signalingState === 'stable'
        ) {
          this.cancelRecovery()
          this.retryIndex = 0
          this.recoveryEpisode = false
          this.snapshot.runtimeStatus = 'connected'
        }
        this.emit()
      },
      onSignalSendFailed: () => {
        if (isCurrentPeer()) {
          this.handlePeerFailure(peer!)
        }
      },
      onRecoveryNeeded: () => {
        if (isCurrentPeer()) {
          this.handlePeerFailure(peer!)
        }
      },
      onScreenShareStateChanged: (state) => {
        if (isCurrentPeer()) {
          this.snapshot.screenShareState = state
          this.refreshPeerProjection(peer!)
          this.emit()
        }
      },
      onRemoteVideoChanged: (stream, state) => {
        if (isCurrentPeer()) {
          this.snapshot.remoteVideoState = state
          this.callbacks.onRemoteVideoChanged(stream, state)
          this.emit()
        }
      },
      onHostScreenShareChanged: (active) => {
        if (isCurrentPeer()) {
          this.update({ hostScreenShareActive: active })
        }
      },
      onMediaOperationFailed: () => {
        if (isCurrentPeer()) {
          this.callbacks.onNotice(
            'A browser media operation failed safely. The peer remains available.',
          )
        }
      },
    }

    peer = this.dependencies.createPeerController(this.session.role, hub, callbacks)
    this.peer = peer
    this.snapshot.peerStatus = initialPeerConnectionStatus
    this.snapshot.peerActive = false
    this.snapshot.hostSenderTrackState = 'not-created'
    this.snapshot.screenShareState = 'inactive'
    this.snapshot.displayCaptureRequestPending = false
    this.snapshot.remoteVideoState = 'unavailable'
    this.snapshot.hostScreenShareActive = false
    this.callbacks.onRemoteVideoChanged(null, 'unavailable')
    this.refreshPeerProjection(peer)
    this.emit()
    return peer
  }

  private disposePeer(notifyRemote: boolean): void {
    const peer = this.peer
    this.peer = null
    ++this.peerGeneration

    if (peer !== null) {
      peer.resetPeer(notifyRemote)
      peer.close()
    }

    this.snapshot.peerStatus = closedPeerStatus
    this.snapshot.peerActive = false
    this.snapshot.hostSenderTrackState = 'not-created'
    this.snapshot.screenShareState = 'inactive'
    this.snapshot.displayCaptureRequestPending = false
    this.snapshot.remoteVideoState = 'unavailable'
    this.snapshot.hostScreenShareActive = false
    this.callbacks.onRemoteVideoChanged(null, 'unavailable')
    this.emit()
  }

  private handleHubDisconnected(): void {
    this.cancelRecovery()
    this.disposePeer(false)
    this.update({
      hubStatus: 'disconnected',
      runtimeStatus: 'unavailable',
      presence: [],
    })
  }

  // Only a Hub lost after being established is retried; an initial start() failure is not.
  private handleUnexpectedHubDisconnect(): void {
    if (this.snapshot.hubStatus !== 'connected') {
      return
    }

    const hub = this.hub
    const generation = this.hubGeneration
    this.handleHubDisconnected()
    this.hubRetryIndex = 0
    this.callbacks.onNotice(
      'The Room Hub disconnected unexpectedly. Attempting automatic reconnection.',
    )

    if (hub !== null) {
      this.scheduleHubReconnect(hub, generation)
    }
  }

  private scheduleHubReconnect(hub: RoomHubRuntime, generation: number): void {
    if (
      this.disposed ||
      this.cancelScheduledHubReconnect !== null ||
      this.hub !== hub ||
      this.hubGeneration !== generation
    ) {
      return
    }

    const delay = this.dependencies.hubReconnectDelaysMilliseconds[this.hubRetryIndex]
    if (delay === undefined) {
      this.update({ hubStatus: 'disconnected', runtimeStatus: 'unavailable' })
      this.callbacks.onNotice(
        'The Room Hub could not be reached automatically. Diagnostics may be needed.',
      )
      return
    }

    this.hubRetryIndex += 1
    this.cancelScheduledHubReconnect = this.dependencies.schedule(() => {
      this.cancelScheduledHubReconnect = null
      void this.attemptHubReconnect(hub, generation)
    }, delay)
  }

  private async attemptHubReconnect(hub: RoomHubRuntime, generation: number): Promise<void> {
    if (this.disposed || this.hub !== hub || this.hubGeneration !== generation) {
      return
    }

    this.update({ hubStatus: 'connecting' })

    try {
      await hub.start()
    } catch {
      if (this.disposed || this.hub !== hub || this.hubGeneration !== generation) {
        return
      }
      this.scheduleHubReconnect(hub, generation)
      return
    }

    if (this.disposed || this.hub !== hub || this.hubGeneration !== generation) {
      await hub.stop().catch(() => undefined)
      return
    }

    this.hubRetryIndex = 0
    this.resetFailureEpisode()
    this.update({ hubStatus: 'connected', runtimeStatus: 'waiting-for-counterpart' })
    this.reconcileCounterpart()
  }

  private cancelHubReconnect(): void {
    this.cancelScheduledHubReconnect?.()
    this.cancelScheduledHubReconnect = null
  }

  private resetFailureEpisode(): void {
    this.cancelRecovery()
    this.retryIndex = 0
    this.recoveryEpisode = false
  }

  private cancelRecovery(): void {
    ++this.recoveryGeneration
    this.cancelScheduledRecovery?.()
    this.cancelScheduledRecovery = null
  }

  private isCounterpartOnline(): boolean {
    const counterpartRole: ParticipantRole =
      this.session.role === 'Host' ? 'Guest' : 'Host'
    return this.snapshot.presence.some(
      (participant) => participant.role === counterpartRole && participant.connected,
    )
  }

  private refreshPeerProjection(peer: RoomPeerRuntime): void {
    this.snapshot.peerActive = peer.hasActivePeer
    this.snapshot.hostSenderTrackState = peer.hostSenderTrackState
    this.snapshot.screenShareState = peer.screenShareState
    this.snapshot.displayCaptureRequestPending = peer.hasPendingDisplayCaptureRequest
    this.snapshot.hostScreenShareActive = peer.hostScreenShareActive
  }

  private update(update: Partial<RoomRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update }
    this.emit()
  }

  private emit(): void {
    this.callbacks.onStateChanged(this.copySnapshot())
  }

  private copySnapshot(): RoomRuntimeSnapshot {
    return {
      ...this.snapshot,
      presence: [...this.snapshot.presence],
      peerStatus: { ...this.snapshot.peerStatus },
    }
  }
}
