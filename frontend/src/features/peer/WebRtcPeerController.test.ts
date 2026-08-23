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
  type PeerSignaling,
} from './WebRtcPeerController'

const browserOfferSdp = 'v=0\r\ns=browser offer\r\n'
const browserAnswerSdp = 'v=0\r\ns=browser answer\r\n'

describe('WebRtcPeerController', () => {
  it('creates one trackless sendonly Host transceiver and relays the exact browser Offer', async () => {
    const mediaDevices = {
      getDisplayMedia: vi.fn(),
      getUserMedia: vi.fn(),
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    })
    const fixture = createFixture('Host')

    await fixture.controller.startHostNegotiation(true)

    expect(fixture.configurations).toEqual([{ iceServers: [] }])
    expect(fixture.peer.transceivers).toEqual([
      { kind: 'video', direction: 'sendonly', track: null },
    ])
    expect(fixture.peer.callOrder).toContain('createOffer')
    expect(fixture.peer.localDescriptions).toEqual([
      { type: 'offer', sdp: browserOfferSdp },
    ])
    expect(fixture.signaling.offers).toEqual([browserOfferSdp])
    expect(fixture.controller.hostSenderTrackState).toBe('null')
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled()
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled()

    await expect(fixture.controller.startHostNegotiation(true)).rejects.toThrow(
      'already active',
    )
    expect(fixture.peer.transceivers).toHaveLength(1)
  })

  it('does not let a Guest initiate an Offer or create a peer', async () => {
    const fixture = createFixture('Guest')

    await expect(fixture.controller.startHostNegotiation(true)).rejects.toThrow(
      'Only the Host',
    )

    expect(fixture.configurations).toHaveLength(0)
    expect(fixture.signaling.offers).toHaveLength(0)
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

  it('queues early remote ICE and flushes it in order after the remote description', async () => {
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
    expect(fixture.peer.callOrder.indexOf('setRemoteDescription:offer')).toBeLessThan(
      fixture.peer.callOrder.indexOf('addIceCandidate:candidate:first'),
    )
  })

  it('passes later remote ICE fields through without parsing or rewriting', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleOffer(offer(browserOfferSdp))
    const signal = ice('  candidate:opaque browser value  ', 'Host')

    await fixture.controller.handleRemoteIceCandidate(signal)

    expect(fixture.peer.addedCandidates.at(-1)).toEqual(candidateFromSignal(signal))
  })

  it('rejects Offer and Answer handling for the wrong local or sender roles', async () => {
    const host = createFixture('Host')
    const guest = createFixture('Guest')

    await expect(host.controller.handleOffer(offer(browserOfferSdp))).rejects.toThrow(
      'not valid',
    )
    await expect(
      guest.controller.handleAnswer({ ...answer(browserAnswerSdp), role: 'Host' }),
    ).rejects.toThrow('not valid')

    expect(host.configurations).toHaveLength(0)
    expect(guest.configurations).toHaveLength(0)
  })

  it('close removes handlers, clears queued ICE, closes the peer, and reports closed state', async () => {
    const fixture = createFixture('Guest')
    await fixture.controller.handleRemoteIceCandidate(ice('candidate:queued', 'Host'))

    fixture.controller.close()

    expect(fixture.controller.pendingRemoteCandidateCount).toBe(0)
    expect(fixture.peer.closed).toBe(true)
    expect(fixture.peer.onicecandidate).toBeNull()
    expect(fixture.peer.onconnectionstatechange).toBeNull()
    expect(fixture.statuses.at(-1)).toMatchObject({
      connectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
    })
  })
})

function createFixture(role: ParticipantRole) {
  const peer = new FakePeerConnection()
  const signaling = new FakePeerSignaling()
  const configurations: RTCConfiguration[] = []
  const statuses: PeerConnectionStatus[] = []
  const factory: PeerConnectionFactory = (configuration) => {
    configurations.push(configuration)
    return peer as unknown as RTCPeerConnection
  }
  const controller = new WebRtcPeerController(
    role,
    signaling,
    {
      onStatusChanged: (status) => statuses.push(status),
      onSignalSendFailed: () => undefined,
    },
    factory,
  )

  return { controller, peer, signaling, configurations, statuses }
}

class FakePeerSignaling implements PeerSignaling {
  public connected = true
  public readonly offers: string[] = []
  public readonly answers: string[] = []
  public readonly candidates: RTCIceCandidateInit[] = []

  public isConnected(): boolean {
    return this.connected
  }

  public async sendOffer(sdp: string): Promise<void> {
    this.offers.push(sdp)
  }

  public async sendAnswer(sdp: string): Promise<void> {
    this.answers.push(sdp)
  }

  public async sendIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
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
  public closed = false

  public addTransceiver(
    kind: string,
    init: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    const sender = { track: null }
    this.transceivers.push({ kind, direction: init.direction ?? 'sendrecv', track: sender.track })
    return { sender } as unknown as RTCRtpTransceiver
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.callOrder.push('createOffer')
    return { type: 'offer', sdp: browserOfferSdp }
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
    this.remoteDescriptions.push(description)
    this.remoteDescription = description as RTCSessionDescription
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.callOrder.push(`addIceCandidate:${candidate.candidate}`)
    this.addedCandidates.push(candidate)
  }

  public close(): void {
    this.closed = true
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    this.signalingState = 'closed'
  }

  public emitLocalCandidate(candidate: RTCIceCandidateInit): void {
    const browserCandidate = {
      ...candidate,
      toJSON: () => candidate,
    } as RTCIceCandidate
    this.onicecandidate?.call(
      this as unknown as RTCPeerConnection,
      { candidate: browserCandidate } as RTCPeerConnectionIceEvent,
    )
  }

  public emitEndOfCandidates(): void {
    this.onicecandidate?.call(
      this as unknown as RTCPeerConnection,
      { candidate: null } as RTCPeerConnectionIceEvent,
    )
  }
}

function offer(sdp: string): RoomWebRtcOffer {
  return {
    participantId: 'host-participant',
    role: 'Host',
    sdp,
  }
}

function answer(sdp: string): RoomWebRtcAnswer {
  return {
    participantId: 'guest-participant',
    role: 'Guest',
    sdp,
  }
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
