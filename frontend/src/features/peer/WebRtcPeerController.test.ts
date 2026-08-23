import { describe, expect, it, vi } from 'vitest'
import type {
  ParticipantRole,
  PeerConnectionStatus,
  RoomIceCandidate,
  RoomScreenShareStateChanged,
  RoomWebRtcAnswer,
  RoomWebRtcOffer,
} from './contracts'
import {
  WebRtcPeerController,
  type DisplayMediaProvider,
  type PeerConnectionFactory,
  type PeerRecoveryReason,
  type PeerSignaling,
  type RemoteMediaStreamFactory,
  type RemoteVideoState,
  type ScreenShareState,
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

    expect(fixture.configurations).toEqual([{ iceServers: [], iceTransportPolicy: 'all' }])
    expect(transceiverStates(fixture.peer)).toEqual([
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

  it('passes the configured iceServers to a new RTCPeerConnection for both roles', async () => {
    const iceServers: RTCIceServer[] = [
      { urls: ['stun:stun.example.com:3478'] },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' },
    ]
    const host = createFixture('Host', iceServers)

    await host.controller.startHostNegotiation(true)

    expect(host.configurations).toEqual([{ iceServers, iceTransportPolicy: 'all' }])

    const guest = createFixture('Guest', iceServers)

    await guest.controller.handleOffer(offer(browserOfferSdp))

    expect(guest.configurations).toEqual([{ iceServers, iceTransportPolicy: 'all' }])
  })

  it('passes an explicit non-default iceTransportPolicy to a new RTCPeerConnection', async () => {
    const iceServers: RTCIceServer[] = [{ urls: ['turn:turn.example.com:3478'] }]
    const fixture = createFixture('Host', iceServers, 'relay')

    await fixture.controller.startHostNegotiation(true)

    expect(fixture.configurations).toEqual([{ iceServers, iceTransportPolicy: 'relay' }])
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
    expect(transceiverStates(fixture.peers[1])).toEqual([
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

  it('enforces Host role and peer readiness before requesting display capture', async () => {
    const guest = createFixture('Guest')
    const hostWithoutPeer = createFixture('Host')
    const hostWithUnreadyPeer = createFixture('Host')

    await guest.controller.handleOffer(offer(browserOfferSdp))
    await expect(guest.controller.startScreenShare()).rejects.toThrow('Only the Host')
    await expect(hostWithoutPeer.controller.startScreenShare()).rejects.toThrow(
      'connected Host peer',
    )
    await hostWithUnreadyPeer.controller.startHostNegotiation(true)
    await hostWithUnreadyPeer.controller.handleAnswer(answer(browserAnswerSdp))
    await expect(hostWithUnreadyPeer.controller.startScreenShare()).rejects.toThrow(
      'stable connected Host peer',
    )

    expect(guest.displayMediaProvider).not.toHaveBeenCalled()
    expect(hostWithoutPeer.displayMediaProvider).not.toHaveBeenCalled()
    expect(hostWithUnreadyPeer.displayMediaProvider).not.toHaveBeenCalled()
  })

  it('attaches exact display video to the existing sender without renegotiation or audio', async () => {
    const fixture = createFixture('Host')
    const videoTrack = fakeTrack('video')
    const unexpectedAudioTrack = fakeTrack('audio')
    fixture.displayMediaProvider.mockResolvedValueOnce(
      fakeStream(videoTrack, unexpectedAudioTrack),
    )
    await establishConnectedHost(fixture)
    const existingPeer = fixture.peer
    const existingSender = hostSender(existingPeer)
    const offerCount = fixture.signaling.offers.length
    const localDescriptionCount = existingPeer.localDescriptions.length
    expect(fixture.displayMediaProvider).not.toHaveBeenCalled()

    await fixture.controller.startScreenShare()

    expect(fixture.displayMediaProvider).toHaveBeenCalledTimes(1)
    expect(fixture.displayMediaProvider).toHaveBeenCalledWith({
      video: true,
      audio: false,
    })
    expect(fixture.peers).toEqual([existingPeer])
    expect(transceiverStates(existingPeer)).toEqual([
      { kind: 'video', direction: 'sendonly', track: videoTrack },
    ])
    expect(existingSender.replaceTrackCalls).toEqual([videoTrack])
    expect(existingSender.track).toBe(videoTrack)
    expect(unexpectedAudioTrack.stopCount).toBe(1)
    expect(fixture.controller.screenShareState).toBe('active')
    expect(fixture.screenShareStates).toEqual(['requesting', 'active'])
    expect(fixture.signaling.screenShareStateCalls).toEqual([true])
    expect(fixture.signaling.offers).toHaveLength(offerCount)
    expect(fixture.signaling.answers).toHaveLength(0)
    expect(existingPeer.localDescriptions).toHaveLength(localDescriptionCount)
  })

  it('prevents concurrent capture requests and invalidates a pending request on stop', async () => {
    const fixture = createFixture('Host')
    const permission = deferred<MediaStream>()
    const lateTrack = fakeTrack()
    fixture.displayMediaProvider.mockReturnValueOnce(permission.promise)
    await establishConnectedHost(fixture)

    const firstAttempt = fixture.controller.startScreenShare()
    await vi.waitFor(() => expect(fixture.controller.screenShareState).toBe('requesting'))

    await expect(fixture.controller.startScreenShare()).rejects.toThrow('already active')
    expect(fixture.displayMediaProvider).toHaveBeenCalledTimes(1)

    await fixture.controller.stopScreenShare()
    expect(fixture.controller.hasPendingDisplayCaptureRequest).toBe(true)
    await expect(fixture.controller.startScreenShare()).rejects.toThrow(
      'already active or requesting permission',
    )
    expect(fixture.displayMediaProvider).toHaveBeenCalledTimes(1)
    permission.resolve(fakeStream(lateTrack))

    await expect(firstAttempt).rejects.toThrow('Screen capture could not be started')
    expect(fixture.controller.hasPendingDisplayCaptureRequest).toBe(false)
    expect(lateTrack.stopCount).toBe(1)
    expect(hostSender(fixture.peer).replaceTrackCalls).toHaveLength(0)
    expect(fixture.controller.screenShareState).toBe('inactive')
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.signaling.screenShareStateCalls).toHaveLength(0)
  })

  it('keeps the peer retryable after picker cancellation without exposing browser details', async () => {
    const fixture = createFixture('Host')
    const retryTrack = fakeTrack()
    fixture.displayMediaProvider
      .mockRejectedValueOnce(new Error('private browser permission detail'))
      .mockResolvedValueOnce(fakeStream(retryTrack))
    await establishConnectedHost(fixture)

    const cancelledAttempt = fixture.controller.startScreenShare()

    await expect(cancelledAttempt).rejects.toThrow('Screen capture could not be started')
    await expect(cancelledAttempt).rejects.not.toThrow('private browser permission detail')
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(false)
    expect(fixture.controller.screenShareState).toBe('inactive')
    expect(fixture.signaling.screenShareStateCalls).toHaveLength(0)

    await fixture.controller.startScreenShare()

    expect(fixture.displayMediaProvider).toHaveBeenCalledTimes(2)
    expect(hostSender(fixture.peer).track).toBe(retryTrack)
    expect(fixture.controller.screenShareState).toBe('active')
    expect(fixture.signaling.screenShareStateCalls).toEqual([true])
  })

  it('stops unusable acquired tracks and allows a fresh capture attempt', async () => {
    const fixture = createFixture('Host')
    const audioTrack = fakeTrack('audio')
    const retryTrack = fakeTrack()
    fixture.displayMediaProvider
      .mockResolvedValueOnce(fakeStream(audioTrack))
      .mockResolvedValueOnce(fakeStream(retryTrack))
    await establishConnectedHost(fixture)

    await expect(fixture.controller.startScreenShare()).rejects.toThrow(
      'Screen capture could not be started',
    )

    expect(audioTrack.stopCount).toBe(1)
    expect(hostSender(fixture.peer).track).toBeNull()
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.signaling.screenShareStateCalls).toHaveLength(0)

    await fixture.controller.startScreenShare()

    expect(hostSender(fixture.peer).track).toBe(retryTrack)
    expect(fixture.signaling.screenShareStateCalls).toEqual([true])
  })

  it('stops a track after replaceTrack failure while preserving a retryable peer', async () => {
    const fixture = createFixture('Host')
    const failedTrack = fakeTrack()
    const retryTrack = fakeTrack()
    fixture.displayMediaProvider
      .mockResolvedValueOnce(fakeStream(failedTrack))
      .mockResolvedValueOnce(fakeStream(retryTrack))
    await establishConnectedHost(fixture)
    const sender = hostSender(fixture.peer)
    sender.replaceTrackError = new Error('private sender failure')

    const failedAttempt = fixture.controller.startScreenShare()

    await expect(failedAttempt).rejects.toThrow('Screen capture could not be started')
    await expect(failedAttempt).rejects.not.toThrow('private sender failure')
    expect(failedTrack.stopCount).toBe(1)
    expect(sender.track).toBeNull()
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(false)
    expect(fixture.controller.screenShareState).toBe('inactive')
    expect(fixture.signaling.screenShareStateCalls).toHaveLength(0)

    sender.replaceTrackError = null
    await fixture.controller.startScreenShare()

    expect(sender.track).toBe(retryTrack)
    expect(fixture.signaling.screenShareStateCalls).toEqual([true])
  })

  it('rolls back capture safely when the active share-state signal fails', async () => {
    const fixture = createFixture('Host')
    const videoTrack = fakeTrack()
    fixture.displayMediaProvider.mockResolvedValueOnce(fakeStream(videoTrack))
    fixture.signaling.screenShareStateError = new Error('private Hub failure')
    await establishConnectedHost(fixture)
    const sender = hostSender(fixture.peer)

    const failedAttempt = fixture.controller.startScreenShare()

    await expect(failedAttempt).rejects.toThrow('Screen capture could not be started')
    await expect(failedAttempt).rejects.not.toThrow('private Hub failure')
    expect(sender.replaceTrackCalls).toEqual([videoTrack, null])
    expect(sender.track).toBeNull()
    expect(videoTrack.stopCount).toBe(1)
    expect(videoTrack.onended).toBeNull()
    expect(fixture.controller.screenShareState).toBe('inactive')
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.controller.requiresResetBeforeRetry).toBe(false)
    expect(fixture.signaling.screenShareStateCalls).toEqual([true, false])
  })

  it('explicitly stops sharing, detaches the sender, and remains idempotent', async () => {
    const fixture = createFixture('Host')
    const videoTrack = fakeTrack()
    fixture.displayMediaProvider.mockResolvedValueOnce(fakeStream(videoTrack))
    await establishConnectedHost(fixture)
    await fixture.controller.startScreenShare()
    const sender = hostSender(fixture.peer)

    await fixture.controller.stopScreenShare()
    await fixture.controller.stopScreenShare()

    expect(sender.replaceTrackCalls).toEqual([videoTrack, null])
    expect(sender.track).toBeNull()
    expect(videoTrack.stopCount).toBe(1)
    expect(videoTrack.onended).toBeNull()
    expect(fixture.controller.screenShareState).toBe('inactive')
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.peer.closed).toBe(false)
    expect(fixture.signaling.screenShareStateCalls).toEqual([true, false])
  })

  it('handles browser-native track end without letting an old ended callback affect a new share', async () => {
    const fixture = createFixture('Host')
    const firstTrack = fakeTrack()
    const secondTrack = fakeTrack()
    fixture.displayMediaProvider
      .mockResolvedValueOnce(fakeStream(firstTrack))
      .mockResolvedValueOnce(fakeStream(secondTrack))
    await establishConnectedHost(fixture)
    await fixture.controller.startScreenShare()
    const staleEndedHandler = firstTrack.onended

    await fixture.controller.stopScreenShare()
    await fixture.controller.startScreenShare()
    staleEndedHandler?.call(firstTrack as unknown as MediaStreamTrack, new Event('ended'))

    expect(hostSender(fixture.peer).track).toBe(secondTrack)
    expect(secondTrack.stopCount).toBe(0)
    expect(fixture.controller.screenShareState).toBe('active')
    expect(fixture.signaling.screenShareStateCalls).toEqual([true, false, true])

    secondTrack.emitEnded()
    await vi.waitFor(() => expect(fixture.controller.screenShareState).toBe('inactive'))

    expect(hostSender(fixture.peer).track).toBeNull()
    expect(secondTrack.stopCount).toBe(1)
    expect(fixture.controller.hasActivePeer).toBe(true)
    expect(fixture.peer.closed).toBe(false)
    expect(fixture.signaling.screenShareStateCalls).toEqual([
      true,
      false,
      true,
      false,
    ])
  })

  it('stops a late permission result and never attaches it to a replacement generation', async () => {
    const fixture = createFixture('Host')
    const permission = deferred<MediaStream>()
    const staleTrack = fakeTrack()
    fixture.displayMediaProvider.mockReturnValueOnce(permission.promise)
    await establishConnectedHost(fixture)
    const oldPeer = fixture.peer
    const oldSender = hostSender(oldPeer)
    const pendingCapture = fixture.controller.startScreenShare()
    await vi.waitFor(() => expect(fixture.controller.screenShareState).toBe('requesting'))

    fixture.controller.resetPeer()
    await establishConnectedHost(fixture)
    const replacementPeer = fixture.peer
    await expect(fixture.controller.startScreenShare()).rejects.toThrow(
      'already active or requesting permission',
    )
    expect(fixture.displayMediaProvider).toHaveBeenCalledTimes(1)
    permission.resolve(fakeStream(staleTrack))

    await expect(pendingCapture).rejects.toThrow('Screen capture could not be started')
    expect(staleTrack.stopCount).toBe(1)
    expect(oldSender.replaceTrackCalls).toHaveLength(0)
    expect(hostSender(replacementPeer).replaceTrackCalls).toHaveLength(0)
    expect(hostSender(replacementPeer).track).toBeNull()
    expect(fixture.controller.hasActivePeer).toBe(true)

    const currentTrack = fakeTrack()
    fixture.displayMediaProvider.mockResolvedValueOnce(fakeStream(currentTrack))
    await fixture.controller.startScreenShare()
    expect(hostSender(replacementPeer).track).toBe(currentTrack)
  })

  it.each(['reset', 'close', 'failure'] as const)(
    'stops active capture during peer %s cleanup',
    async (cleanup) => {
      const fixture = createFixture('Host')
      const track = fakeTrack()
      fixture.displayMediaProvider.mockResolvedValueOnce(fakeStream(track))
      await establishConnectedHost(fixture)
      await fixture.controller.startScreenShare()
      const peer = fixture.peer
      const sender = hostSender(peer)

      if (cleanup === 'reset') {
        fixture.controller.resetPeer()
      } else if (cleanup === 'close') {
        fixture.controller.close()
      } else {
        peer.emitConnectionState('failed')
      }

      expect(track.stopCount).toBe(1)
      expect(sender.replaceTrackCalls).toEqual([track, null])
      expect(sender.track).toBeNull()
      expect(fixture.controller.screenShareState).toBe('inactive')
      expect(peer.closed).toBe(true)
      expect(fixture.signaling.screenShareStateCalls).toEqual([true, false])
    },
  )

  it('wraps a streamless Guest video track and follows mute, unmute, and ended state', async () => {
    const fixture = createFixture('Guest')
    const remoteTrack = fakeTrack('video', true)
    const ignoredAudioTrack = fakeTrack('audio')
    await fixture.controller.handleOffer(offer(browserOfferSdp))

    fixture.peer.emitRemoteTrack(ignoredAudioTrack as unknown as MediaStreamTrack)
    fixture.peer.emitRemoteTrack(remoteTrack as unknown as MediaStreamTrack, [])

    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledTimes(1)
    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledWith([
      remoteTrack as unknown as MediaStreamTrack,
    ])
    expect(fixture.remoteVideoChanges.at(-1)).toMatchObject({ state: 'waiting' })
    expect(fixture.remoteVideoChanges.at(-1)?.stream).not.toBeNull()

    remoteTrack.emitUnmute()
    expect(fixture.remoteVideoChanges.at(-1)).toMatchObject({ state: 'receiving' })

    remoteTrack.emitMute()
    expect(fixture.remoteVideoChanges.at(-1)).toMatchObject({ state: 'waiting' })

    remoteTrack.emitEnded()
    expect(fixture.remoteVideoChanges.at(-1)).toEqual({
      stream: null,
      state: 'unavailable',
    })
    expect(fixture.controller.hasActivePeer).toBe(true)
  })

  it('keeps Guest stream ownership separate from trusted Host share activity', async () => {
    const fixture = createFixture('Guest')
    const remoteTrack = fakeTrack()
    await fixture.controller.handleOffer(offer(browserOfferSdp))
    fixture.peer.emitRemoteTrack(remoteTrack as unknown as MediaStreamTrack, [])
    const remoteStream = fixture.remoteVideoChanges.at(-1)?.stream
    const remoteChangeCount = fixture.remoteVideoChanges.length

    fixture.controller.handleScreenShareStateChanged(screenShareState(true))

    expect(fixture.controller.hostScreenShareActive).toBe(true)
    expect(fixture.hostScreenShareStates).toEqual([true])
    expect(fixture.remoteVideoChanges).toHaveLength(remoteChangeCount)
    expect(fixture.remoteVideoChanges.at(-1)?.stream).toBe(remoteStream)

    fixture.controller.handleScreenShareStateChanged(screenShareState(false))

    expect(fixture.controller.hostScreenShareActive).toBe(false)
    expect(fixture.hostScreenShareStates).toEqual([true, false])
    expect(fixture.remoteVideoChanges).toHaveLength(remoteChangeCount)
    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledTimes(1)

    fixture.controller.handleScreenShareStateChanged(screenShareState(true))

    expect(fixture.controller.hostScreenShareActive).toBe(true)
    expect(fixture.hostScreenShareStates).toEqual([true, false, true])
    expect(fixture.remoteVideoChanges.at(-1)?.stream).toBe(remoteStream)
    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledTimes(1)

    fixture.controller.resetPeer()
    fixture.controller.handleScreenShareStateChanged(screenShareState(true))

    expect(fixture.controller.hostScreenShareActive).toBe(false)
    expect(fixture.hostScreenShareStates).toEqual([true, false, true, false])

    fixture.controller.close()
    fixture.controller.handleScreenShareStateChanged(screenShareState(true))
    expect(fixture.hostScreenShareStates).toEqual([true, false, true, false])
  })

  it('clears Guest media on reset and rejects stale ontrack callbacks from old generations', async () => {
    const fixture = createFixture('Guest')
    const firstTrack = fakeTrack()
    await fixture.controller.handleOffer(offer(browserOfferSdp))
    const oldPeer = fixture.peer
    const staleOnTrack = oldPeer.ontrack
    oldPeer.emitRemoteTrack(firstTrack as unknown as MediaStreamTrack)
    const staleUnmute = firstTrack.onunmute

    fixture.controller.resetPeer()

    expect(fixture.remoteVideoChanges.at(-1)).toEqual({
      stream: null,
      state: 'unavailable',
    })
    expect(oldPeer.ontrack).toBeNull()

    await fixture.controller.handleOffer(offer(browserOfferSdp))
    const replacementPeer = fixture.peer
    const staleTrack = fakeTrack()
    staleOnTrack?.call(
      oldPeer as unknown as RTCPeerConnection,
      { track: staleTrack, streams: [] } as unknown as RTCTrackEvent,
    )
    staleUnmute?.call(firstTrack as unknown as MediaStreamTrack, new Event('unmute'))

    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledTimes(1)
    expect(fixture.remoteVideoChanges.at(-1)).toEqual({
      stream: null,
      state: 'unavailable',
    })

    const currentTrack = fakeTrack()
    replacementPeer.emitRemoteTrack(currentTrack as unknown as MediaStreamTrack)
    expect(fixture.remoteMediaStreamFactory).toHaveBeenCalledTimes(2)
    expect(fixture.remoteVideoChanges.at(-1)).toMatchObject({ state: 'receiving' })
  })
})

function createFixture(
  role: ParticipantRole,
  iceServers: RTCIceServer[] = [],
  iceTransportPolicy: RTCIceTransportPolicy = 'all',
) {
  const signaling = new FakePeerSignaling()
  const configurations: RTCConfiguration[] = []
  const statuses: PeerConnectionStatus[] = []
  const recoveryReasons: PeerRecoveryReason[] = []
  const screenShareStates: ScreenShareState[] = []
  const hostScreenShareStates: boolean[] = []
  const remoteVideoChanges: Array<{
    stream: MediaStream | null
    state: RemoteVideoState
  }> = []
  let mediaOperationFailures = 0
  const peers: FakePeerConnection[] = []
  let signalSendFailures = 0
  let nextPeerSetup: ((peer: FakePeerConnection) => void) | null = null
  const displayMediaProvider = vi.fn<DisplayMediaProvider>()
  const remoteMediaStreamFactory = vi.fn<RemoteMediaStreamFactory>((tracks) =>
    new FakeMediaStream(tracks) as unknown as MediaStream,
  )
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
      onScreenShareStateChanged: (state) => screenShareStates.push(state),
      onRemoteVideoChanged: (stream, state) => {
        remoteVideoChanges.push({ stream, state })
      },
      onHostScreenShareChanged: (active) => hostScreenShareStates.push(active),
      onMediaOperationFailed: () => {
        mediaOperationFailures += 1
      },
    },
    iceServers,
    iceTransportPolicy,
    factory,
    displayMediaProvider,
    remoteMediaStreamFactory,
  )

  return {
    controller,
    signaling,
    configurations,
    statuses,
    recoveryReasons,
    screenShareStates,
    hostScreenShareStates,
    remoteVideoChanges,
    displayMediaProvider,
    remoteMediaStreamFactory,
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
    get mediaOperationFailures() {
      return mediaOperationFailures
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
  public recoveryRequestCount = 0
  public readonly screenShareStateCalls: boolean[] = []
  public offerError: Error | null = null
  public answerError: Error | null = null
  public candidateError: Error | null = null
  public screenShareStateError: Error | null = null

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

  public async requestPeerRecovery(): Promise<void> {
    this.recoveryRequestCount += 1
  }

  public async sendScreenShareState(active: boolean): Promise<void> {
    this.screenShareStateCalls.push(active)
    if (this.screenShareStateError !== null) {
      throw this.screenShareStateError
    }
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
  public ontrack: RTCPeerConnection['ontrack'] = null
  public readonly transceivers: Array<{
    kind: string
    direction: RTCRtpTransceiverDirection
    sender: FakeRtpSender
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
    const sender = new FakeRtpSender()
    this.transceivers.push({
      kind,
      direction: init.direction ?? 'sendrecv',
      sender,
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

  public emitRemoteTrack(track: MediaStreamTrack, streams: MediaStream[] = []): void {
    this.ontrack?.call(
      this as unknown as RTCPeerConnection,
      { track, streams } as unknown as RTCTrackEvent,
    )
  }
}

class FakeRtpSender {
  public track: MediaStreamTrack | null = null
  public readonly replaceTrackCalls: Array<MediaStreamTrack | null> = []
  public replaceTrackError: Error | null = null

  public async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    this.replaceTrackCalls.push(track)
    if (this.replaceTrackError !== null) {
      throw this.replaceTrackError
    }

    this.track = track
  }
}

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[]

  public constructor(tracks: MediaStreamTrack[]) {
    this.tracks = tracks
  }

  public getTracks(): MediaStreamTrack[] {
    return [...this.tracks]
  }
}

class FakeMediaStreamTrack {
  public readonly kind: 'video' | 'audio'
  public readyState: MediaStreamTrackState = 'live'
  public muted: boolean
  public onended: MediaStreamTrack['onended'] = null
  public onmute: MediaStreamTrack['onmute'] = null
  public onunmute: MediaStreamTrack['onunmute'] = null
  public stopCount = 0

  public constructor(kind: 'video' | 'audio' = 'video', muted = false) {
    this.kind = kind
    this.muted = muted
  }

  public stop(): void {
    this.stopCount += 1
    this.readyState = 'ended'
  }

  public emitEnded(): void {
    const handler = this.onended
    this.readyState = 'ended'
    handler?.call(this as unknown as MediaStreamTrack, new Event('ended'))
  }

  public emitMute(): void {
    this.muted = true
    this.onmute?.call(this as unknown as MediaStreamTrack, new Event('mute'))
  }

  public emitUnmute(): void {
    this.muted = false
    this.onunmute?.call(this as unknown as MediaStreamTrack, new Event('unmute'))
  }
}

type TestFixture = ReturnType<typeof createFixture>

async function establishConnectedHost(fixture: TestFixture): Promise<void> {
  await fixture.controller.startHostNegotiation(true)
  await fixture.controller.handleAnswer(answer(browserAnswerSdp))
  fixture.peer.emitConnectionState('connected')
}

function hostSender(peer: FakePeerConnection): FakeRtpSender {
  const sender = peer.transceivers[0]?.sender
  if (sender === undefined) {
    throw new Error('The test expected the Host video sender to exist.')
  }

  return sender
}

function transceiverStates(peer: FakePeerConnection) {
  return peer.transceivers.map(({ kind, direction, sender }) => ({
    kind,
    direction,
    track: sender.track,
  }))
}

function fakeTrack(
  kind: 'video' | 'audio' = 'video',
  muted = false,
): FakeMediaStreamTrack {
  return new FakeMediaStreamTrack(kind, muted)
}

function fakeStream(...tracks: FakeMediaStreamTrack[]): MediaStream {
  return new FakeMediaStream(
    tracks.map((track) => track as unknown as MediaStreamTrack),
  ) as unknown as MediaStream
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

function screenShareState(active: boolean): RoomScreenShareStateChanged {
  return { participantId: 'host-participant', role: 'Host', active }
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
