import { describe, expect, it, vi } from 'vitest'
import type {
  ParticipantRole,
  PeerConnectionStatus,
  RoomIceCandidate,
  RoomWebRtcAnswer,
  RoomWebRtcOffer,
} from './contracts'
import {
  WebRtcPeerController,
  type PeerConnectionFactory,
  type PeerRecoveryReason,
  type PeerSignaling,
} from './WebRtcPeerController'

const browserOfferSdp = 'v=0\r\ns=browser offer\r\n'
const browserAnswerSdp = 'v=0\r\ns=browser answer\r\n'

describe('WebRtcPeerController', () => {
  it('creates one trackless sendonly Host transceiver and relays the exact browser Offer', async () => {
    const getDisplayMedia = vi.fn()
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia, getUserMedia },
    })
    const fixture = createFixture('Host')

    await fixture.controller.startHostNegotiation(true)

    expect(fixture.configurations).toEqual([{ iceServers: [] }])
    expect(fixture.peer.transceivers).toEqual([
      { kind: 'video', direction: 'sendonly', track: null },
    ])
    expect(fixture.peer.localDescriptions).toEqual([
      { type: 'offer', sdp: browserOfferSdp },
    ])
    expect(fixture.signaling.offers).toEqual([browserOfferSdp])
    expect(fixture.controller.hostSenderTrackState).toBe('null')
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()

    await expect(fixture.controller.startHostNegotiation(true)).rejects.toThrow(
      'already active',
    )
    expect(fixture.peer.transceivers).toHaveLength(1)
  })

  it('checks role, Hub connectivity, and Guest presence before creating a peer', async () => {
    const guest = createFixture('Guest')
    const disconnectedHost = createFixture('Host')
    disconnectedHost.signaling.connected = false
    const loneHost = createFixture('Host')

    await expect(guest.controller.startHostNegotiation(true)).rejects.toThrow('Only the Host')
    await expect(disconnectedHost.controller.startHostNegotiation(true)).rejects.toThrow(
      'Hub is disconnected',
    )
    await expect(loneHost.controller.startHostNegotiation(false)).rejects.toThrow(
      'Guest must be online',
    )

    expect(guest.peers).toHaveLength(0)
    expect(disconnectedHost.peers).toHaveLength(0)
    expect(loneHost.peers).toHaveLength(0)
  })

  it('applies the exact Host Offer before creating and relaying the exact Guest Answer', async () => {
    const fixture = createFixture('Guest')

    await fixture.controller.handleOffer(offer(browserOfferSdp))

    expect(fixture.peer.remoteDescriptions).toEqual([
      { type: 'offer', sdp: browserOfferSdp },
    ])
    expect(fixture.peer.callOrder.indexOf('setRemoteDescription:offer')).toBeLessThan(
      fixture.peer.callOrder.indexOf('createAnswer'),
    )
    expect(fixture.peer.transceivers).toHaveLength(0)
    expect(fixture.signaling.answers).toEqual([browserAnswerSdp])
  })

  it('applies the exact Guest Answer to an active Host negotiation', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)

    await fixture.controller.handleAnswer(answer(browserAnswerSdp))

    expect(fixture.peer.remoteDescriptions).toEqual([
      { type: 'answer', sdp: browserAnswerSdp },
    ])
  })

  it('relays non-null local browser ICE fields exactly and ignores end-of-candidates', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)
    const candidate: RTCIceCandidateInit = {
      candidate: '  candidate:browser-value  ',
      sdpMid: 'video',
      sdpMLineIndex: 0,
      usernameFragment: 'browser-ufrag',
    }

    fixture.peer.emitLocalCandidate(candidate)
    fixture.peer.emitEndOfCandidates()
    await Promise.resolve()

    expect(fixture.signaling.candidates).toEqual([candidate])
  })

  it('queues early Guest ICE and flushes it in order after the Offer', async () => {
    const fixture = createFixture('Guest')
    const first = ice('candidate:first', 'Host')
    const second = ice('candidate:second', 'Host')

    await fixture.controller.handleRemoteIceCandidate(first)
    await fixture.controller.handleRemoteIceCandidate(second)

    expect(fixture.controller.pendingRemoteCandidateCount).toBe(2)
    expect(fixture.peer.addedCandidates).toHaveLength(0)

    await fixture.controller.handleOffer(offer(browserOfferSdp))

    expect(fixture.peer.addedCandidates).toEqual([
      candidateFromSignal(first),
      candidateFromSignal(second),
    ])
    expect(fixture.controller.pendingRemoteCandidateCount).toBe(0)
  })

  it('rejects unsolicited Host ICE without creating a meaningless peer', async () => {
    const fixture = createFixture('Host')

    await expect(
      fixture.controller.handleRemoteIceCandidate(ice('candidate:unsolicited', 'Guest')),
    ).rejects.toThrow('no Host negotiation')

    expect(fixture.peers).toHaveLength(0)
    expect(fixture.controller.pendingRemoteCandidateCount).toBe(0)
  })

  it('rejects signaling for wrong roles without creating a peer', async () => {
    const host = createFixture('Host')
    const guest = createFixture('Guest')

    await expect(host.controller.handleOffer(offer(browserOfferSdp))).rejects.toThrow(
      'not valid',
    )
    await expect(
      guest.controller.handleAnswer({ ...answer(browserAnswerSdp), role: 'Host' }),
    ).rejects.toThrow('not valid')
    await expect(
      guest.controller.handleRemoteIceCandidate(ice('candidate:same-role', 'Guest')),
    ).rejects.toThrow('wrong role')

    expect(host.peers).toHaveLength(0)
    expect(guest.peers).toHaveLength(0)
  })

  it('requires an explicit reset after a failed Host attempt and retries with a fresh peer', async () => {
    const fixture = createFixture('Host')
    fixture.signaling.offerError = new Error('Hub send failed')

    await expect(fixture.controller.startHostNegotiation(true)).rejects.toThrow(
      'Hub send failed',
    )

    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.hasActivePeer).toBe(false)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
    await expect(fixture.controller.startHostNegotiation(true)).rejects.toThrow('Reset')

    fixture.signaling.offerError = null
    fixture.controller.resetPeer()
    await fixture.controller.startHostNegotiation(true)

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers[1]).not.toBe(fixture.peers[0])
    expect(fixture.peers[1].transceivers).toEqual([
      { kind: 'video', direction: 'sendonly', track: null },
    ])
    expect(fixture.controller.requiresResetBeforeRetry).toBe(false)
  })

  it('closes a failed Guest setup and allows a clean retry after reset', async () => {
    const fixture = createFixture('Guest')
    fixture.nextPeerSetup = (peer) => {
      peer.setRemoteDescriptionError = new Error('Offer application failed')
    }

    await expect(fixture.controller.handleOffer(offer(browserOfferSdp))).rejects.toThrow(
      'Offer application failed',
    )

    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)

    fixture.controller.resetPeer()
    await fixture.controller.handleOffer(offer(browserOfferSdp))

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.signaling.answers).toEqual([browserAnswerSdp])
  })

  it('closes a Host attempt when applying the Answer fails', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)
    fixture.peer.setRemoteDescriptionError = new Error('Answer application failed')

    await expect(fixture.controller.handleAnswer(answer(browserAnswerSdp))).rejects.toThrow(
      'Answer application failed',
    )

    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('rejects and cleans up a duplicate Offer instead of applying it to a stable peer', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleOffer(offer(browserOfferSdp))

    await expect(fixture.controller.handleOffer(offer(browserOfferSdp))).rejects.toThrow(
      'current signaling state',
    )

    expect(fixture.peer.remoteDescriptions).toHaveLength(1)
    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('rejects and cleans up a duplicate Answer instead of applying it to a stable peer', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)
    await fixture.controller.handleAnswer(answer(browserAnswerSdp))

    await expect(fixture.controller.handleAnswer(answer(browserAnswerSdp))).rejects.toThrow(
      'current signaling state',
    )

    expect(fixture.peer.remoteDescriptions).toHaveLength(1)
    expect(fixture.peer.closed).toBe(true)
  })

  it('ignores stale ICE callbacks from a reset generation', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)
    const oldPeer = fixture.peer
    const staleIceHandler = oldPeer.onicecandidate

    fixture.controller.resetPeer()
    await fixture.controller.startHostNegotiation(true)
    const candidate = browserCandidate({ candidate: 'candidate:stale' })
    staleIceHandler?.call(
      oldPeer as unknown as RTCPeerConnection,
      { candidate } as RTCPeerConnectionIceEvent,
    )
    await Promise.resolve()

    expect(fixture.signaling.candidates).toHaveLength(0)
    expect(fixture.controller.hasActivePeer).toBe(true)
  })

  it('prevents a stale async Offer result from signaling after reset and retry', async () => {
    const fixture = createFixture('Host')
    const pendingOffer = deferred<RTCSessionDescriptionInit>()
    fixture.nextPeerSetup = (peer) => {
      peer.createOfferPromise = pendingOffer.promise
    }
    const firstAttempt = fixture.controller.startHostNegotiation(true)
    await Promise.resolve()

    fixture.controller.resetPeer()
    await fixture.controller.startHostNegotiation(true)
    pendingOffer.resolve({ type: 'offer', sdp: 'v=0\r\ns=stale\r\n' })

    await expect(firstAttempt).rejects.toThrow('replaced or reset')
    expect(fixture.signaling.offers).toEqual([browserOfferSdp])
    expect(fixture.peers[0].closed).toBe(true)
    expect(fixture.controller.hasActivePeer).toBe(true)
  })

  it('invalidates pending peer work when Hub ownership closes the controller', async () => {
    const fixture = createFixture('Host')
    const pendingOffer = deferred<RTCSessionDescriptionInit>()
    fixture.nextPeerSetup = (peer) => {
      peer.createOfferPromise = pendingOffer.promise
    }
    const negotiation = fixture.controller.startHostNegotiation(true)
    await Promise.resolve()

    fixture.controller.close()
    pendingOffer.resolve({ type: 'offer', sdp: 'v=0\r\ns=late-after-hub-close\r\n' })

    await expect(negotiation).rejects.toThrow('replaced or reset')
    expect(fixture.signaling.offers).toHaveLength(0)
    expect(fixture.controller.hasActivePeer).toBe(false)
    expect(fixture.controller.pendingRemoteCandidateCount).toBe(0)
    await expect(
      fixture.controller.handleRemoteIceCandidate(ice('candidate:late', 'Guest')),
    ).rejects.toThrow('controller is closed')
  })

  it('turns a local ICE send rejection into a safe reset-required state', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)
    fixture.signaling.candidateError = new Error('ICE send failed')

    fixture.peer.emitLocalCandidate({ candidate: 'candidate:send-failure' })

    await vi.waitFor(() => expect(fixture.signalSendFailures).toBe(1))
    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.hasActivePeer).toBe(false)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('cleans up when adding a remote ICE candidate fails without exposing candidate text', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleOffer(offer(browserOfferSdp))
    fixture.peer.addIceCandidateError = new Error('Candidate application failed')

    const failure = fixture.controller.handleRemoteIceCandidate(
      ice('candidate:private-value', 'Host'),
    )

    await expect(failure).rejects.toThrow('Candidate application failed')
    await expect(failure).rejects.not.toThrow('candidate:private-value')
    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('surfaces failed state as recoverable and disposes the failed peer', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)

    fixture.peer.emitConnectionState('failed')

    expect(fixture.recoveryReasons).toEqual(['connection-failed'])
    expect(fixture.statuses.at(-1)?.connectionState).toBe('failed')
    expect(fixture.peer.closed).toBe(true)
    expect(fixture.controller.hasActivePeer).toBe(false)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('keeps disconnected state visible because it may recover without a new generation', async () => {
    const fixture = createFixture('Host')
    await fixture.controller.startHostNegotiation(true)

    fixture.peer.emitConnectionState('disconnected')

    expect(fixture.statuses.at(-1)?.connectionState).toBe('disconnected')
    expect(fixture.recoveryReasons).toHaveLength(0)
    expect(fixture.peer.closed).toBe(false)
    expect(fixture.controller.hasActivePeer).toBe(true)
  })

  it('treats ICE failure like connection failure and requests recovery only once', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleOffer(offer(browserOfferSdp))

    fixture.peer.emitIceConnectionState('failed')
    fixture.peer.onconnectionstatechange?.call(
      fixture.peer as unknown as RTCPeerConnection,
      new Event('connectionstatechange'),
    )

    expect(fixture.recoveryReasons).toEqual(['connection-failed'])
    expect(fixture.controller.requiresResetBeforeRetry).toBe(true)
  })

  it('makes repeated peer reset and full close idempotent and keeps close permanent', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleRemoteIceCandidate(ice('candidate:queued', 'Host'))
    const firstPeer = fixture.peer

    fixture.controller.resetPeer()
    fixture.controller.resetPeer()
    fixture.controller.close()
    fixture.controller.close()

    expect(firstPeer.closeCount).toBe(1)
    expect(fixture.controller.pendingRemoteCandidateCount).toBe(0)
    expect(fixture.statuses.at(-1)).toMatchObject({
      connectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
    })
    await expect(fixture.controller.handleOffer(offer(browserOfferSdp))).rejects.toThrow(
      'controller is closed',
    )
  })
})

function createFixture(role: ParticipantRole) {
  const signaling = new FakePeerSignaling()
  const configurations: RTCConfiguration[] = []
  const statuses: PeerConnectionStatus[] = []
  const recoveryReasons: PeerRecoveryReason[] = []
  const peers: FakePeerConnection[] = []
  let signalSendFailures = 0
  let nextPeerSetup: ((peer: FakePeerConnection) => void) | null = null
  const factory: PeerConnectionFactory = (configuration) => {
    configurations.push(configuration)
    const peer = new FakePeerConnection()
    nextPeerSetup?.(peer)
    nextPeerSetup = null
    peers.push(peer)
    return peer as unknown as RTCPeerConnection
  }
  const controller = new WebRtcPeerController(
    role,
    signaling,
    {
      onStatusChanged: (status) => statuses.push(status),
      onSignalSendFailed: () => {
        signalSendFailures += 1
      },
      onRecoveryNeeded: (reason) => recoveryReasons.push(reason),
    },
    factory,
  )

  return {
    controller,
    signaling,
    configurations,
    statuses,
    recoveryReasons,
    peers,
    get peer() {
      const peer = peers.at(-1)
      if (peer === undefined) {
        throw new Error('The test expected a peer connection to exist.')
      }

      return peer
    },
    get signalSendFailures() {
      return signalSendFailures
    },
    set nextPeerSetup(setup: ((peer: FakePeerConnection) => void) | null) {
      nextPeerSetup = setup
    },
  }
}

class FakePeerSignaling implements PeerSignaling {
  public connected = true
  public readonly offers: string[] = []
  public readonly answers: string[] = []
  public readonly candidates: RTCIceCandidateInit[] = []
  public offerError: Error | null = null
  public answerError: Error | null = null
  public candidateError: Error | null = null

  public isConnected(): boolean {
    return this.connected
  }

  public async sendOffer(sdp: string): Promise<void> {
    if (this.offerError !== null) {
      throw this.offerError
    }

    this.offers.push(sdp)
  }

  public async sendAnswer(sdp: string): Promise<void> {
    if (this.answerError !== null) {
      throw this.answerError
    }

    this.answers.push(sdp)
  }

  public async sendIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.candidateError !== null) {
      throw this.candidateError
    }

    this.candidates.push(candidate)
  }
}

class FakePeerConnection {
  public connectionState: RTCPeerConnectionState = 'new'
  public iceConnectionState: RTCIceConnectionState = 'new'
  public iceGatheringState: RTCIceGatheringState = 'new'
  public signalingState: RTCSignalingState = 'stable'
  public localDescription: RTCSessionDescription | null = null
  public remoteDescription: RTCSessionDescription | null = null
  public onicecandidate: RTCPeerConnection['onicecandidate'] = null
  public onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null
  public oniceconnectionstatechange: RTCPeerConnection['oniceconnectionstatechange'] = null
  public onicegatheringstatechange: RTCPeerConnection['onicegatheringstatechange'] = null
  public onsignalingstatechange: RTCPeerConnection['onsignalingstatechange'] = null
  public readonly transceivers: Array<{
    kind: string
    direction: RTCRtpTransceiverDirection
    track: MediaStreamTrack | null
  }> = []
  public readonly localDescriptions: RTCSessionDescriptionInit[] = []
  public readonly remoteDescriptions: RTCSessionDescriptionInit[] = []
  public readonly addedCandidates: RTCIceCandidateInit[] = []
  public readonly callOrder: string[] = []
  public createOfferPromise: Promise<RTCSessionDescriptionInit> | null = null
  public setRemoteDescriptionError: Error | null = null
  public addIceCandidateError: Error | null = null
  public closed = false
  public closeCount = 0

  public addTransceiver(kind: string, init: RTCRtpTransceiverInit): RTCRtpTransceiver {
    const sender = { track: null }
    this.transceivers.push({
      kind,
      direction: init.direction ?? 'sendrecv',
      track: sender.track,
    })
    return { sender } as unknown as RTCRtpTransceiver
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.callOrder.push('createOffer')
    return this.createOfferPromise ?? { type: 'offer', sdp: browserOfferSdp }
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.callOrder.push('createAnswer')
    return { type: 'answer', sdp: browserAnswerSdp }
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.callOrder.push(`setLocalDescription:${description.type}`)
    this.localDescriptions.push(description)
    this.localDescription = description as RTCSessionDescription
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.callOrder.push(`setRemoteDescription:${description.type}`)
    if (this.setRemoteDescriptionError !== null) {
      throw this.setRemoteDescriptionError
    }

    this.remoteDescriptions.push(description)
    this.remoteDescription = description as RTCSessionDescription
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.callOrder.push(`addIceCandidate:${candidate.candidate}`)
    if (this.addIceCandidateError !== null) {
      throw this.addIceCandidateError
    }

    this.addedCandidates.push(candidate)
  }

  public close(): void {
    this.closeCount += 1
    this.closed = true
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    this.signalingState = 'closed'
  }

  public emitLocalCandidate(candidate: RTCIceCandidateInit): void {
    this.onicecandidate?.call(
      this as unknown as RTCPeerConnection,
      { candidate: browserCandidate(candidate) } as RTCPeerConnectionIceEvent,
    )
  }

  public emitEndOfCandidates(): void {
    this.onicecandidate?.call(
      this as unknown as RTCPeerConnection,
      { candidate: null } as RTCPeerConnectionIceEvent,
    )
  }

  public emitConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state
    this.onconnectionstatechange?.call(
      this as unknown as RTCPeerConnection,
      new Event('connectionstatechange'),
    )
  }

  public emitIceConnectionState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state
    this.oniceconnectionstatechange?.call(
      this as unknown as RTCPeerConnection,
      new Event('iceconnectionstatechange'),
    )
  }
}

function browserCandidate(candidate: RTCIceCandidateInit): RTCIceCandidate {
  return { ...candidate, toJSON: () => candidate } as RTCIceCandidate
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function offer(sdp: string): RoomWebRtcOffer {
  return { participantId: 'host-participant', role: 'Host', sdp }
}

function answer(sdp: string): RoomWebRtcAnswer {
  return { participantId: 'guest-participant', role: 'Guest', sdp }
}

function ice(candidate: string, role: ParticipantRole): RoomIceCandidate {
  return {
    participantId: `${role.toLowerCase()}-participant`,
    role,
    candidate,
    sdpMid: 'video',
    sdpMLineIndex: 0,
    usernameFragment: 'opaque-ufrag',
  }
}

function candidateFromSignal(signal: RoomIceCandidate): RTCIceCandidateInit {
  return {
    candidate: signal.candidate,
    sdpMid: signal.sdpMid,
    sdpMLineIndex: signal.sdpMLineIndex,
    usernameFragment: signal.usernameFragment,
  }
}
