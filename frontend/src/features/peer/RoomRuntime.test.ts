import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RoomRuntime,
  type RoomHubRuntime,
  type RoomPeerRuntime,
  type RoomRuntimeDependencies,
  type RoomRuntimeSnapshot,
} from './RoomRuntime'
import type { RoomHubHandlers } from './RoomHubClient'
import {
  initialPeerConnectionStatus,
  type ParticipantRole,
  type RoomPresenceParticipant,
  type RoomSession,
  type RoomWebRtcOffer,
} from './contracts'
import type {
  PeerSignaling,
  ScreenShareState,
  WebRtcPeerCallbacks,
} from './WebRtcPeerController'

const roomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'
const hostSession: RoomSession = {
  roomId,
  participantId: 'ec71c4ae-dbc9-4fb4-94bd-acbfeb04389a',
  role: 'Host',
  credential: 'H'.repeat(43),
}
const guestSession: RoomSession = {
  roomId,
  participantId: '3305e07a-0c6b-477d-9ff8-82ba80114e29',
  role: 'Guest',
  credential: 'G'.repeat(43),
}
const hostPresence: RoomPresenceParticipant = {
  participantId: hostSession.participantId,
  role: 'Host',
  connected: true,
}
const guestPresence: RoomPresenceParticipant = {
  participantId: guestSession.participantId,
  role: 'Guest',
  connected: true,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RoomRuntime automatic orchestration', () => {
  it('keeps a lone Host waiting without creating offers or peer connections', async () => {
    const fixture = createFixture(hostSession, [hostPresence])

    await fixture.runtime.start()

    expect(fixture.peers).toHaveLength(0)
    expect(fixture.hub.recoveryRequestCount).toBe(0)
    expect(fixture.latest.runtimeStatus).toBe('waiting-for-counterpart')
  })

  it('starts exactly one Host attempt when a snapshot already contains the Guest', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])

    await fixture.runtime.start()
    fixture.hub.emitSnapshot([hostPresence, guestPresence])
    fixture.hub.emitPresence(guestPresence)

    expect(fixture.peers).toHaveLength(1)
    expect(fixture.peers[0].startHostNegotiationCount).toBe(1)
    expect(fixture.latest.runtimeStatus).toBe('negotiating')
    expect(fixture.peers[0].startScreenShareCount).toBe(0)
  })

  it('keeps the Guest passive until a Host Offer arrives', async () => {
    const fixture = createFixture(guestSession, [hostPresence, guestPresence])

    await fixture.runtime.start()

    expect(fixture.peers).toHaveLength(0)
    expect(fixture.hub.recoveryRequestCount).toBe(0)

    fixture.hub.emitOffer(hostOffer())
    await vi.waitFor(() => expect(fixture.peers).toHaveLength(1))

    expect(fixture.peers[0].handleOfferCount).toBe(1)
    expect(fixture.peers[0].startHostNegotiationCount).toBe(0)
  })

  it('cleans an offline counterpart and automatically starts fresh when it returns', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const firstPeer = fixture.peers[0]

    fixture.hub.emitPresence({ ...guestPresence, connected: false })

    expect(firstPeer.resetNotifyValues).toEqual([false])
    expect(firstPeer.closeCount).toBe(1)
    expect(fixture.latest.runtimeStatus).toBe('waiting-for-counterpart')

    fixture.hub.emitPresence(guestPresence)

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1].startHostNegotiationCount).toBe(1)
  })

  it('recovers a failed Host peer with fresh cleanup and bounded scheduling', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const failedPeer = fixture.peers[0]

    failedPeer.emitRecoveryNeeded()
    await vi.advanceTimersByTimeAsync(0)

    expect(failedPeer.closeCount).toBe(1)
    expect(fixture.hub.recoveryRequestCount).toBe(1)
    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1].startHostNegotiationCount).toBe(1)
  })

  it('lets a failed Guest request Host recovery without creating a competing offer', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(guestSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    fixture.hub.emitOffer(hostOffer())
    await vi.waitFor(() => expect(fixture.peers).toHaveLength(1))

    fixture.peers[0].emitRecoveryNeeded()
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.hub.recoveryRequestCount).toBe(1)
    expect(fixture.peers).toHaveLength(1)
    expect(fixture.peers[0].startHostNegotiationCount).toBe(0)
  })

  it('replaces the current Host attempt when the Guest requests recovery', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const firstPeer = fixture.peers[0]

    fixture.hub.emitRecoveryRequest('Guest')
    await vi.advanceTimersByTimeAsync(0)

    expect(firstPeer.closeCount).toBe(1)
    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1].startHostNegotiationCount).toBe(1)
  })

  it('exhausts a finite retry budget instead of looping forever', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      Number.POSITIVE_INFINITY,
    )

    await fixture.runtime.start()
    await vi.runAllTimersAsync()

    expect(fixture.peers).toHaveLength(4)
    expect(fixture.hub.recoveryRequestCount).toBe(3)
    expect(fixture.latest.runtimeStatus).toBe('unavailable')
    expect(vi.getTimerCount()).toBe(0)

    fixture.hub.emitSnapshot([hostPresence, guestPresence])
    fixture.hub.emitPresence(guestPresence)
    expect(fixture.peers).toHaveLength(4)

    fixture.hub.emitPresence({ ...guestPresence, connected: false })
    fixture.hub.emitPresence(guestPresence)
    expect(fixture.peers).toHaveLength(5)
    await fixture.runtime.stop()
  })

  it('ignores a stale failed-peer callback after a replacement is healthy', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const stalePeer = fixture.peers[0]
    stalePeer.emitRecoveryNeeded()
    await vi.advanceTimersByTimeAsync(0)
    const replacement = fixture.peers[1]
    replacement.emitConnected()

    stalePeer.emitRecoveryNeeded()
    await vi.runAllTimersAsync()

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.latest.runtimeStatus).toBe('connected')
  })

  it('cancels pending recovery when the Room runtime is stopped', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    fixture.peers[0].emitRecoveryNeeded()

    await fixture.runtime.stop()
    await vi.runAllTimersAsync()

    expect(fixture.peers).toHaveLength(1)
    expect(fixture.hub.recoveryRequestCount).toBe(0)
    expect(fixture.hub.stopCount).toBe(1)
  })

  it('cleans active capture on counterpart offline and never starts capture automatically', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const peer = fixture.peers[0]
    peer.screenShareStateValue = 'active'

    fixture.hub.emitPresence({ ...guestPresence, connected: false })

    expect(peer.resetNotifyValues).toEqual([false])
    expect(peer.startScreenShareCount).toBe(0)
    expect(fixture.latest.screenShareState).toBe('inactive')
  })

  it('cleans peer/media on Hub disconnect and renegotiates from a fresh snapshot after reconnect', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const oldPeer = fixture.peers[0]

    await fixture.runtime.disconnectHubForDiagnostics()

    expect(oldPeer.closeCount).toBe(1)
    expect(fixture.latest.hubStatus).toBe('disconnected')

    fixture.hub.nextStartPresence = [hostPresence, guestPresence]
    await fixture.runtime.reconnectHubForDiagnostics()

    expect(fixture.latest.hubStatus).toBe('connected')
    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1].startHostNegotiationCount).toBe(1)
  })
})

describe('RoomRuntime automatic Hub recovery', () => {
  it('cleans the current peer and active screen capture on unexpected Hub disconnect', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const peer = fixture.peers[0]
    peer.screenShareStateValue = 'active'

    fixture.hub.emitDisconnect()

    expect(peer.resetNotifyValues).toEqual([false])
    expect(peer.closeCount).toBe(1)
    expect(fixture.latest.hubStatus).toBe('disconnected')
    expect(fixture.latest.runtimeStatus).toBe('unavailable')
    expect(fixture.latest.screenShareState).toBe('inactive')
    expect(fixture.latest.presence).toEqual([])
  })

  it('automatically schedules and completes a bounded Hub reconnect, restoring Hub state', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()

    fixture.hub.emitDisconnect()
    expect(fixture.latest.hubStatus).toBe('disconnected')
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.hub.startCount).toBe(2)
    expect(fixture.latest.hubStatus).toBe('connected')
    expect(fixture.latest.presence).toEqual([hostPresence, guestPresence])
  })

  it('renegotiates from fresh presence after Hub reconnect without restarting screen capture', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    fixture.peers[0].screenShareStateValue = 'active'

    fixture.hub.emitDisconnect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1].startHostNegotiationCount).toBe(1)
    expect(fixture.peers[1].startScreenShareCount).toBe(0)
    expect(fixture.latest.screenShareState).toBe('inactive')
  })

  it('keeps the Guest passive after its own Hub reconnects automatically', async () => {
    const fixture = createFixture(guestSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    fixture.hub.emitOffer(hostOffer())
    await vi.waitFor(() => expect(fixture.peers).toHaveLength(1))

    vi.useFakeTimers()
    fixture.hub.emitDisconnect()
    expect(fixture.peers[0].closeCount).toBe(1)

    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.latest.hubStatus).toBe('connected')
    expect(fixture.peers).toHaveLength(1)
    expect(fixture.latest.runtimeStatus).toBe('waiting-for-counterpart')
  })

  it('does not create duplicate Hub retry loops from duplicate disconnect callbacks', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()

    fixture.hub.emitDisconnect()
    fixture.hub.emitDisconnect()
    fixture.hub.emitDisconnect()

    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.hub.startCount).toBe(2)
    expect(fixture.latest.hubStatus).toBe('connected')
  })

  it('exhausts the bounded Hub retry budget and stays unavailable without looping', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()

    fixture.hub.startFailures = Number.POSITIVE_INFINITY
    fixture.hub.emitDisconnect()
    await vi.runAllTimersAsync()

    expect(fixture.hub.startCount).toBe(4)
    expect(fixture.latest.hubStatus).toBe('disconnected')
    expect(fixture.latest.runtimeStatus).toBe('unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending automatic Hub reconnect when the Room runtime is stopped', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    expect(fixture.hub.startCount).toBe(1)

    fixture.hub.emitDisconnect()
    await fixture.runtime.stop()
    await vi.runAllTimersAsync()

    expect(fixture.hub.startCount).toBe(1)
    expect(fixture.hub.stopCount).toBe(1)
  })

  it('a stale Hub reconnect completion cannot revive a stopped runtime', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    fixture.hub.holdStart = true

    fixture.hub.emitDisconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.hub.startCount).toBe(2)

    await fixture.runtime.stop()
    fixture.hub.releasePendingStart(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.latest.hubStatus).toBe('disconnected')
    expect(fixture.hub.stopCount).toBe(2)
    expect(fixture.peers).toHaveLength(1)
  })

  it('ignores a stale peer callback from before the Hub reconnected', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])
    await fixture.runtime.start()
    const oldPeer = fixture.peers[0]

    fixture.hub.emitDisconnect()
    await vi.advanceTimersByTimeAsync(0)

    const newPeer = fixture.peers[1]
    expect(newPeer.startHostNegotiationCount).toBe(1)

    oldPeer.emitRecoveryNeeded()
    oldPeer.emitConnected()

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.latest.runtimeStatus).not.toBe('recovering')
  })
})

describe('RoomRuntime ICE server provisioning', () => {
  const iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.example.com:3478'] },
    { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' },
  ]

  it('fetches ICE configuration once and passes it to the first Host peer', async () => {
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      iceServers,
    )

    await fixture.runtime.start()

    expect(fixture.iceServersRequestCount).toBe(1)
    expect(fixture.peerIceServers).toEqual([iceServers])
  })

  it('passes the configured ICE configuration to a fresh Guest peer', async () => {
    const fixture = createFixture(
      guestSession,
      [hostPresence, guestPresence],
      0,
      iceServers,
    )
    await fixture.runtime.start()

    fixture.hub.emitOffer(hostOffer())
    await vi.waitFor(() => expect(fixture.peers).toHaveLength(1))

    expect(fixture.peerIceServers).toEqual([iceServers])
  })

  it('reuses the same in-memory ICE configuration for a fresh peer during automatic recovery', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      iceServers,
    )
    await fixture.runtime.start()

    fixture.peers[0].emitRecoveryNeeded()
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.iceServersRequestCount).toBe(1)
    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peerIceServers).toEqual([iceServers, iceServers])
  })

  it('falls back to an empty ICE configuration and surfaces a notice when the fetch fails', async () => {
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      new Error('simulated ICE configuration failure'),
    )

    await fixture.runtime.start()

    expect(fixture.peerIceServers).toEqual([[]])
    expect(
      fixture.notices.some((notice) => notice.includes('baseline connection setup')),
    ).toBe(true)
    expect(fixture.notices.join(' ')).not.toContain('simulated ICE configuration failure')
  })

  it('a new RoomRuntime instance fetches its own fresh ICE configuration', async () => {
    const firstFixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      [{ urls: ['stun:first.example.com:3478'] }],
    )
    await firstFixture.runtime.start()
    await firstFixture.runtime.stop()

    const secondFixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      [{ urls: ['stun:second.example.com:3478'] }],
    )
    await secondFixture.runtime.start()

    expect(firstFixture.peerIceServers).toEqual([
      [{ urls: ['stun:first.example.com:3478'] }],
    ])
    expect(secondFixture.peerIceServers).toEqual([
      [{ urls: ['stun:second.example.com:3478'] }],
    ])
  })
})

describe('RoomRuntime development-only forced-relay seam', () => {
  it('defaults to "all" when no iceTransportPolicy dependency override is given', async () => {
    const fixture = createFixture(hostSession, [hostPresence, guestPresence])

    await fixture.runtime.start()

    expect(fixture.peerIceTransportPolicies).toEqual(['all'])
  })

  it('threads an explicit development "relay" policy to the first peer', async () => {
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      [],
      'relay',
    )

    await fixture.runtime.start()

    expect(fixture.peerIceTransportPolicies).toEqual(['relay'])
  })

  it('keeps the same configured policy for a fresh peer during automatic recovery', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      [],
      'relay',
    )
    await fixture.runtime.start()

    fixture.peers[0].emitRecoveryNeeded()
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peerIceTransportPolicies).toEqual(['relay', 'relay'])
  })

  it('keeps the same configured policy for a fresh peer after automatic Hub reconnect', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(
      hostSession,
      [hostPresence, guestPresence],
      0,
      [],
      'relay',
    )
    await fixture.runtime.start()

    fixture.hub.emitDisconnect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peerIceTransportPolicies).toEqual(['relay', 'relay'])
  })
})

function createFixture(
  session: RoomSession,
  initialPresence: RoomPresenceParticipant[],
  peerStartFailures = 0,
  initialIceServersResult: RTCIceServer[] | Error = [],
  iceTransportPolicy: RTCIceTransportPolicy = 'all',
) {
  const snapshots: RoomRuntimeSnapshot[] = []
  const notices: string[] = []
  const hub = new FakeHub(initialPresence)
  const peers: FakePeer[] = []
  const peerIceServers: (readonly RTCIceServer[])[] = []
  const peerIceTransportPolicies: RTCIceTransportPolicy[] = []
  let remainingStartFailures = peerStartFailures
  let iceServersRequestCount = 0
  let currentIceServersResult = initialIceServersResult
  const dependencies: RoomRuntimeDependencies = {
    createHubClient: (_session, handlers) => {
      hub.handlers = handlers
      return hub
    },
    createPeerController: (role, signaling, callbacks, iceServers, transportPolicy) => {
      const peer = new FakePeer(role, signaling, callbacks)
      peerIceServers.push(iceServers)
      peerIceTransportPolicies.push(transportPolicy)
      if (remainingStartFailures > 0) {
        peer.startError = new Error('simulated negotiation failure')
        remainingStartFailures -= 1
      }
      peers.push(peer)
      return peer
    },
    fetchIceServers: () => {
      iceServersRequestCount += 1
      return currentIceServersResult instanceof Error
        ? Promise.reject(currentIceServersResult)
        : Promise.resolve(currentIceServersResult)
    },
    iceTransportPolicy,
    schedule: (callback, delay) => {
      const timer = window.setTimeout(callback, delay)
      return () => window.clearTimeout(timer)
    },
    retryDelaysMilliseconds: [0, 300, 1_000],
    hubReconnectDelaysMilliseconds: [0, 300, 1_000],
  }
  const runtime = new RoomRuntime(
    session,
    {
      onStateChanged: (snapshot) => snapshots.push(snapshot),
      onRemoteVideoChanged: () => undefined,
      onNotice: (message) => notices.push(message),
    },
    dependencies,
  )

  return {
    runtime,
    hub,
    peers,
    peerIceServers,
    peerIceTransportPolicies,
    notices,
    snapshots,
    setIceServersResult(result: RTCIceServer[] | Error) {
      currentIceServersResult = result
    },
    get iceServersRequestCount() {
      return iceServersRequestCount
    },
    get latest() {
      return snapshots.at(-1) ?? runtime.state
    },
  }
}

class FakeHub implements RoomHubRuntime {
  public handlers: RoomHubHandlers | null = null
  public connected = false
  public stopCount = 0
  public startCount = 0
  public startFailures = 0
  public holdStart = false
  public recoveryRequestCount = 0
  public nextStartPresence: RoomPresenceParticipant[]
  private pendingStart: { resolve: () => void; reject: (error: Error) => void } | null = null

  public constructor(initialPresence: RoomPresenceParticipant[]) {
    this.nextStartPresence = initialPresence
  }

  public async start(): Promise<void> {
    this.startCount += 1

    if (this.holdStart) {
      await new Promise<void>((resolve, reject) => {
        this.pendingStart = { resolve, reject }
      })
    }

    if (this.startFailures > 0) {
      this.startFailures -= 1
      throw new Error('simulated Hub start failure')
    }

    this.connected = true
    this.emitSnapshot(this.nextStartPresence)
  }

  public releasePendingStart(succeed: boolean): void {
    const pending = this.pendingStart
    this.pendingStart = null
    if (pending === null) {
      return
    }

    if (succeed) {
      pending.resolve()
    } else {
      pending.reject(new Error('simulated Hub start failure'))
    }
  }

  public async stop(): Promise<void> {
    this.stopCount += 1
    this.connected = false
  }

  public async disconnect(): Promise<void> {
    this.connected = false
    this.handlers?.onDisconnected()
  }

  public emitDisconnect(): void {
    this.handlers?.onDisconnected()
  }

  public isConnected(): boolean {
    return this.connected
  }

  public async sendOffer(): Promise<void> {}
  public async sendAnswer(): Promise<void> {}
  public async sendIceCandidate(): Promise<void> {}
  public async sendScreenShareState(): Promise<void> {}

  public async requestPeerRecovery(): Promise<void> {
    this.recoveryRequestCount += 1
  }

  public emitSnapshot(participants: RoomPresenceParticipant[]): void {
    this.handlers?.onPresenceSnapshot({ participants })
  }

  public emitPresence(participant: RoomPresenceParticipant): void {
    this.handlers?.onPresenceChanged(participant)
  }

  public emitOffer(offer: RoomWebRtcOffer): void {
    this.handlers?.onWebRtcOffer(offer)
  }

  public emitRecoveryRequest(role: ParticipantRole): void {
    this.handlers?.onWebRtcRecoveryRequested({
      participantId: role === 'Host' ? hostSession.participantId : guestSession.participantId,
      role,
    })
  }
}

class FakePeer implements RoomPeerRuntime {
  public readonly role: ParticipantRole
  public hasActivePeer = false
  public requiresResetBeforeRetry = false
  public screenShareStateValue: ScreenShareState = 'inactive'
  public hasPendingDisplayCaptureRequest = false
  public hostScreenShareActive = false
  public hostSenderTrackState: 'not-created' | 'null' | 'attached' = 'not-created'
  public startHostNegotiationCount = 0
  public handleOfferCount = 0
  public startScreenShareCount = 0
  public stopScreenShareCount = 0
  public closeCount = 0
  public readonly resetNotifyValues: boolean[] = []
  public startError: Error | null = null
  private readonly callbacks: WebRtcPeerCallbacks

  public constructor(
    role: ParticipantRole,
    _signaling: PeerSignaling,
    callbacks: WebRtcPeerCallbacks,
  ) {
    this.role = role
    this.callbacks = callbacks
  }

  public get screenShareState(): ScreenShareState {
    return this.screenShareStateValue
  }

  public async startHostNegotiation(): Promise<void> {
    this.startHostNegotiationCount += 1
    this.hasActivePeer = true
    this.hostSenderTrackState = 'null'
    this.callbacks.onStatusChanged(initialPeerConnectionStatus)
    if (this.startError !== null) {
      this.hasActivePeer = false
      throw this.startError
    }
  }

  public async handleOffer(): Promise<void> {
    this.handleOfferCount += 1
    this.hasActivePeer = true
    this.callbacks.onStatusChanged(initialPeerConnectionStatus)
  }

  public async handleAnswer(): Promise<void> {}
  public async handleRemoteIceCandidate(): Promise<void> {}
  public handleScreenShareStateChanged(): void {}

  public async startScreenShare(): Promise<void> {
    this.startScreenShareCount += 1
  }

  public async stopScreenShare(): Promise<void> {
    this.stopScreenShareCount += 1
  }

  public resetPeer(notifyRemote = true): void {
    this.resetNotifyValues.push(notifyRemote)
    this.hasActivePeer = false
    this.screenShareStateValue = 'inactive'
  }

  public close(): void {
    this.closeCount += 1
  }

  public emitConnected(): void {
    this.hasActivePeer = true
    this.callbacks.onStatusChanged({
      connectionState: 'connected',
      iceConnectionState: 'connected',
      iceGatheringState: 'complete',
      signalingState: 'stable',
    })
  }

  public emitRecoveryNeeded(): void {
    this.callbacks.onRecoveryNeeded('connection-failed')
  }
}

function hostOffer(): RoomWebRtcOffer {
  return {
    participantId: hostSession.participantId,
    role: 'Host',
    sdp: 'v=0\r\n',
  }
}
