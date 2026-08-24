import { describe, expect, it } from 'vitest'
import { computeQualitySnapshot } from './qualitySnapshot'

describe('computeQualitySnapshot', () => {
  it('produces a null bitrate on the first sample (no previous sample to diff against)', () => {
    const report = fakeReport([
      outboundRtpStat({ bytesSent: 10_000, packetsSent: 100 }),
    ])

    const { snapshot } = computeQualitySnapshot({
      report,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: null,
    })

    expect(snapshot.outboundVideo?.bitrateKbps).toBeNull()
    expect(snapshot.outboundVideo?.bytesSent).toBe(10_000)
  })

  it('calculates outbound bitrate correctly from the second sample', () => {
    const first = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 10_000, packetsSent: 100 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    // +125,000 bytes over 2 seconds = 1,000,000 bits / 2s = 500 kbps
    const second = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 135_000, packetsSent: 200 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 2_000,
      previousSample: first.nextSample,
    })

    expect(second.snapshot.outboundVideo?.bitrateKbps).toBeCloseTo(500, 5)
  })

  it('calculates inbound bitrate correctly from the second sample', () => {
    const first = computeQualitySnapshot({
      report: fakeReport([inboundRtpStat({ bytesReceived: 0, packetsReceived: 0 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    // 250,000 bytes over 1 second = 2,000,000 bits / 1s = 2000 kbps
    const second = computeQualitySnapshot({
      report: fakeReport([inboundRtpStat({ bytesReceived: 250_000, packetsReceived: 300 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: first.nextSample,
    })

    expect(second.snapshot.inboundVideo?.bitrateKbps).toBeCloseTo(2_000, 5)
  })

  it('calculates interval packet loss percentage from counter deltas', () => {
    const first = computeQualitySnapshot({
      report: fakeReport([inboundRtpStat({ packetsReceived: 100, packetsLost: 5 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    // Interval: +95 received, +5 lost => 5 / (5 + 95) = 5%
    const second = computeQualitySnapshot({
      report: fakeReport([inboundRtpStat({ packetsReceived: 195, packetsLost: 10 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: first.nextSample,
    })

    expect(second.snapshot.inboundVideo?.packetLossPercent).toBeCloseTo(5, 5)
  })

  it('never produces NaN/Infinity when elapsed time is zero or negative', () => {
    const first = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 10_000, packetsSent: 100 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: null,
    })

    const zeroElapsed = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 20_000, packetsSent: 150 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: first.nextSample,
    })
    const negativeElapsed = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 20_000, packetsSent: 150 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 500,
      previousSample: first.nextSample,
    })

    for (const result of [zeroElapsed, negativeElapsed]) {
      expect(result.snapshot.outboundVideo?.bitrateKbps).toBeNull()
      expect(result.snapshot.outboundVideo?.bitrateKbps).not.toBe(Infinity)
      expect(Number.isNaN(result.snapshot.outboundVideo?.bitrateKbps)).toBe(false)
    }
  })

  it('treats a counter reset (current < previous) as unavailable rather than negative', () => {
    const first = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 500_000, packetsSent: 1_000 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    // Simulated a peer connection replacement where counters restarted from zero.
    const second = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 1_000, packetsSent: 10 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 1_000,
      previousSample: first.nextSample,
    })

    expect(second.snapshot.outboundVideo?.bitrateKbps).toBeNull()
  })

  it('resolves the selected candidate pair through the transport relationship', () => {
    const report = fakeReport([
      { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-1' },
      {
        id: 'pair-1',
        type: 'candidate-pair',
        localCandidateId: 'local-1',
        remoteCandidateId: 'remote-1',
        state: 'succeeded',
        currentRoundTripTime: 0.042,
        availableOutgoingBitrate: 3_200_000,
      },
      // A decoy pair that also succeeded but is not the selected one.
      {
        id: 'pair-2',
        type: 'candidate-pair',
        localCandidateId: 'local-2',
        remoteCandidateId: 'remote-2',
        state: 'succeeded',
      },
      { id: 'local-1', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' },
      { id: 'remote-1', type: 'remote-candidate', candidateType: 'srflx', protocol: 'udp' },
      { id: 'local-2', type: 'local-candidate', candidateType: 'relay', protocol: 'udp' },
      { id: 'remote-2', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' },
    ])

    const { snapshot } = computeQualitySnapshot({
      report,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.connection.selectedPath?.localCandidateType).toBe('srflx')
    expect(snapshot.connection.selectedPath?.remoteCandidateType).toBe('srflx')
    expect(snapshot.connection.selectedPath?.currentRoundTripTimeMs).toBeCloseTo(42, 5)
    expect(snapshot.connection.selectedPath?.availableOutgoingBitrateKbps).toBeCloseTo(3_200, 5)
  })

  it('reports an srflx selected path as srflx', () => {
    const { snapshot } = computeQualitySnapshot({
      report: fakeReport(selectedPairFixture({ localType: 'srflx', remoteType: 'srflx' })),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.connection.selectedPath?.localCandidateType).toBe('srflx')
  })

  it('reports a relay selected path as relay, with a relay protocol and no address exposed', () => {
    const { snapshot } = computeQualitySnapshot({
      report: fakeReport(
        selectedPairFixture({ localType: 'relay', remoteType: 'relay', relayProtocol: 'udp' }),
      ),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.connection.selectedPath?.localCandidateType).toBe('relay')
    expect(snapshot.connection.selectedPath?.relayProtocol).toBe('udp')
  })

  it('resolves the codec name from the referenced codec stat', () => {
    const report = fakeReport([
      outboundRtpStat({ bytesSent: 0, packetsSent: 0, codecId: 'codec-1' }),
      { id: 'codec-1', type: 'codec', mimeType: 'video/VP8' },
    ])

    const { snapshot } = computeQualitySnapshot({
      report,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.outboundVideo?.codec).toBe('VP8')
  })

  it('safely resolves missing optional stats to null', () => {
    const { snapshot } = computeQualitySnapshot({
      report: fakeReport([outboundRtpStat({ bytesSent: 1_000, packetsSent: 10 })]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.outboundVideo?.codec).toBeNull()
    expect(snapshot.outboundVideo?.retransmittedPacketsSent).toBeNull()
    expect(snapshot.outboundVideo?.keyFramesEncoded).toBeNull()
    expect(snapshot.outboundVideo?.qualityLimitationReason).toBeNull()
    expect(snapshot.outboundVideo?.roundTripTimeMs).toBeNull()
    expect(snapshot.connection.selectedPath).toBeNull()
    expect(snapshot.inboundVideo).toBeNull()
    expect(snapshot.outboundVideo?.captureWidth).toBeNull()
    expect(snapshot.outboundVideo?.captureHeight).toBeNull()
    expect(snapshot.outboundVideo?.encodedWidth).toBeNull()
    expect(snapshot.outboundVideo?.encodedHeight).toBeNull()
  })

  it('exposes Host capture and encoded dimensions, and Guest received dimensions, when available', () => {
    const { snapshot } = computeQualitySnapshot({
      report: fakeReport([
        outboundRtpStat({ bytesSent: 1_000, packetsSent: 10, frameWidth: 1280, frameHeight: 720 }),
        inboundRtpStat({ bytesReceived: 1_000, packetsReceived: 10, frameWidth: 1280, frameHeight: 720 }),
      ]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
      captureWidth: 1920,
      captureHeight: 1080,
    })

    expect(snapshot.outboundVideo?.captureWidth).toBe(1920)
    expect(snapshot.outboundVideo?.captureHeight).toBe(1080)
    expect(snapshot.outboundVideo?.encodedWidth).toBe(1280)
    expect(snapshot.outboundVideo?.encodedHeight).toBe(720)
    expect(snapshot.inboundVideo?.frameWidth).toBe(1280)
    expect(snapshot.inboundVideo?.frameHeight).toBe(720)
  })

  it('safely resolves missing dimension fields (older browsers) to null', () => {
    const { snapshot } = computeQualitySnapshot({
      report: fakeReport([
        outboundRtpStat({ bytesSent: 1_000, packetsSent: 10 }),
        inboundRtpStat({ bytesReceived: 1_000, packetsReceived: 10 }),
      ]),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    expect(snapshot.outboundVideo?.captureWidth).toBeNull()
    expect(snapshot.outboundVideo?.captureHeight).toBeNull()
    expect(snapshot.outboundVideo?.encodedWidth).toBeNull()
    expect(snapshot.outboundVideo?.encodedHeight).toBeNull()
    expect(snapshot.inboundVideo?.frameWidth).toBeNull()
    expect(snapshot.inboundVideo?.frameHeight).toBeNull()
  })

  it('does not crash on malformed/incomplete browser stats (wrong types, missing report)', () => {
    const malformedReport = fakeReport([
      {
        id: 'outbound-1',
        type: 'outbound-rtp',
        kind: 'video',
        bytesSent: 'not-a-number',
        packetsSent: null,
        codecId: 42,
      },
      { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'missing-pair' },
    ])

    expect(() =>
      computeQualitySnapshot({
        report: malformedReport,
        connectionState: 'connected',
        iceConnectionState: 'connected',
        signalingState: 'stable',
        nowMs: 0,
        previousSample: null,
      }),
    ).not.toThrow()

    const { snapshot } = computeQualitySnapshot({
      report: malformedReport,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })
    expect(snapshot.outboundVideo?.bytesSent).toBeNull()
    expect(snapshot.outboundVideo?.packetsSent).toBeNull()
    expect(snapshot.outboundVideo?.codec).toBeNull()
    expect(snapshot.connection.selectedPath).toBeNull()
  })

  it('never includes a raw IP address, port, or candidate string in the normalized output', () => {
    const report = fakeReport([
      { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-1' },
      {
        id: 'pair-1',
        type: 'candidate-pair',
        localCandidateId: 'local-1',
        remoteCandidateId: 'remote-1',
        state: 'succeeded',
      },
      {
        id: 'local-1',
        type: 'local-candidate',
        candidateType: 'srflx',
        protocol: 'udp',
        address: '203.0.113.5',
        ip: '203.0.113.5',
        port: 54321,
        candidate: 'candidate:1 1 udp 12345 203.0.113.5 54321 typ srflx',
      },
      {
        id: 'remote-1',
        type: 'remote-candidate',
        candidateType: 'host',
        protocol: 'udp',
        address: '198.51.100.9',
        ip: '198.51.100.9',
        port: 12345,
      },
    ])

    const { snapshot } = computeQualitySnapshot({
      report,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      nowMs: 0,
      previousSample: null,
    })

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('203.0.113.5')
    expect(serialized).not.toContain('198.51.100.9')
    expect(serialized).not.toContain('54321')
    expect(serialized).not.toContain('candidate:1')
    expect(Object.keys(snapshot.connection.selectedPath ?? {})).not.toContain('address')
    expect(Object.keys(snapshot.connection.selectedPath ?? {})).not.toContain('ip')
    expect(Object.keys(snapshot.connection.selectedPath ?? {})).not.toContain('port')
  })
})

function fakeReport(entries: Array<Record<string, unknown>>): RTCStatsReport {
  const map = new Map<string, unknown>()
  for (const entry of entries) {
    map.set(entry.id as string, entry)
  }
  return map as unknown as RTCStatsReport
}

function outboundRtpStat(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'outbound-1',
    type: 'outbound-rtp',
    kind: 'video',
    ...overrides,
  }
}

function inboundRtpStat(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'inbound-1',
    type: 'inbound-rtp',
    kind: 'video',
    ...overrides,
  }
}

function selectedPairFixture(options: {
  localType: string
  remoteType: string
  relayProtocol?: string
}): Array<Record<string, unknown>> {
  return [
    { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-1' },
    {
      id: 'pair-1',
      type: 'candidate-pair',
      localCandidateId: 'local-1',
      remoteCandidateId: 'remote-1',
      state: 'succeeded',
    },
    {
      id: 'local-1',
      type: 'local-candidate',
      candidateType: options.localType,
      protocol: 'udp',
      ...(options.relayProtocol !== undefined ? { relayProtocol: options.relayProtocol } : {}),
    },
    { id: 'remote-1', type: 'remote-candidate', candidateType: options.remoteType, protocol: 'udp' },
  ]
}

