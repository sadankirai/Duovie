import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr'
import {
  roomHubEvents,
  roomHubMethods,
  type RoomIceCandidate,
  type RoomPresenceParticipant,
  type RoomPresenceSnapshot,
  type RoomSession,
  type RoomWebRtcAnswer,
  type RoomWebRtcOffer,
} from './contracts'
import type { PeerSignaling } from './WebRtcPeerController'

export interface RoomHubHandlers {
  onPresenceSnapshot: (snapshot: RoomPresenceSnapshot) => void
  onPresenceChanged: (participant: RoomPresenceParticipant) => void
  onWebRtcOffer: (offer: RoomWebRtcOffer) => void
  onWebRtcAnswer: (answer: RoomWebRtcAnswer) => void
  onIceCandidate: (candidate: RoomIceCandidate) => void
  onDisconnected: () => void
}

export class RoomHubClient implements PeerSignaling {
  private readonly connection: HubConnection
  private readonly handlers: RoomHubHandlers
  private stopping = false
  private disconnectReported = false

  public constructor(session: RoomSession, handlers: RoomHubHandlers) {
    this.handlers = handlers
    this.connection = new HubConnectionBuilder()
      .withUrl(`/hubs/room?roomId=${encodeURIComponent(session.roomId)}`, {
        accessTokenFactory: () => session.credential,
      })
      .configureLogging(LogLevel.Warning)
      .build()

    this.registerHandlers()
    this.connection.onclose(() => {
      this.reportUnexpectedDisconnect()
    })
  }

  public async start(): Promise<void> {
    this.stopping = false
    this.disconnectReported = false
    await this.connection.start()
  }

  public async disconnect(): Promise<void> {
    await this.connection.stop()
    this.reportUnexpectedDisconnect()
  }

  public async stop(): Promise<void> {
    this.stopping = true
    this.unregisterHandlers()
    await this.connection.stop()
  }

  public isConnected(): boolean {
    return this.connection.state === HubConnectionState.Connected
  }

  public async sendOffer(sdp: string): Promise<void> {
    await this.connection.invoke(roomHubMethods.sendWebRtcOffer, sdp)
  }

  public async sendAnswer(sdp: string): Promise<void> {
    await this.connection.invoke(roomHubMethods.sendWebRtcAnswer, sdp)
  }

  public async sendIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.connection.invoke(
      roomHubMethods.sendIceCandidate,
      candidate.candidate,
      candidate.sdpMid ?? null,
      candidate.sdpMLineIndex ?? null,
      candidate.usernameFragment ?? null,
    )
  }

  private registerHandlers(): void {
    this.connection.on(roomHubEvents.presenceSnapshot, this.handlers.onPresenceSnapshot)
    this.connection.on(roomHubEvents.presenceChanged, this.handlers.onPresenceChanged)
    this.connection.on(roomHubEvents.webRtcOffer, this.handlers.onWebRtcOffer)
    this.connection.on(roomHubEvents.webRtcAnswer, this.handlers.onWebRtcAnswer)
    this.connection.on(roomHubEvents.iceCandidate, this.handlers.onIceCandidate)
  }

  private unregisterHandlers(): void {
    this.connection.off(roomHubEvents.presenceSnapshot, this.handlers.onPresenceSnapshot)
    this.connection.off(roomHubEvents.presenceChanged, this.handlers.onPresenceChanged)
    this.connection.off(roomHubEvents.webRtcOffer, this.handlers.onWebRtcOffer)
    this.connection.off(roomHubEvents.webRtcAnswer, this.handlers.onWebRtcAnswer)
    this.connection.off(roomHubEvents.iceCandidate, this.handlers.onIceCandidate)
  }

  private reportUnexpectedDisconnect(): void {
    if (this.stopping || this.disconnectReported) {
      return
    }

    this.disconnectReported = true
    this.handlers.onDisconnected()
  }
}
