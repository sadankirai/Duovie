/**
 * Provider-neutral, frontend-local WebRTC quality telemetry.
 *
 * `computeQualitySnapshot` is a pure function over a raw `RTCStatsReport` (plus the small
 * amount of state needed for delta calculations across polls). It never reads IP addresses,
 * raw ICE candidate strings, TURN credentials, or raw SDP, and it never throws on malformed
 * or missing browser stats — every field safely degrades to `null` instead.
 */

export type CandidateType = 'host' | 'srflx' | 'relay' | 'prflx' | null

export interface SelectedIcePath {
  localCandidateType: CandidateType
  remoteCandidateType: CandidateType
  relayProtocol: string | null
  transportProtocol: string | null
  currentRoundTripTimeMs: number | null
  availableOutgoingBitrateKbps: number | null
}

export interface ConnectionQuality {
  timestampMs: number
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  signalingState: RTCSignalingState
  selectedPath: SelectedIcePath | null
}

export interface OutboundVideoQuality {
  codec: string | null
  bytesSent: number | null
  bitrateKbps: number | null
  packetsSent: number | null
  retransmittedPacketsSent: number | null
  framesEncoded: number | null
  framesSent: number | null
  framesPerSecond: number | null
  keyFramesEncoded: number | null
  totalEncodeTimeSeconds: number | null
  qualityLimitationReason: string | null
  qualityLimitationResolutionChanges: number | null
  /** Reported back by the remote receiver (remote-inbound-rtp), not locally observed. */
  packetsLost: number | null
  packetLossPercent: number | null
  roundTripTimeMs: number | null
  jitterMs: number | null
}

export interface InboundVideoQuality {
  codec: string | null
  bytesReceived: number | null
  bitrateKbps: number | null
  packetsReceived: number | null
  packetsLost: number | null
  packetLossPercent: number | null
  jitterMs: number | null
  framesReceived: number | null
  framesDecoded: number | null
  framesDropped: number | null
  framesPerSecond: number | null
}

export interface QualitySnapshot {
  connection: ConnectionQuality
  outboundVideo: OutboundVideoQuality | null
  inboundVideo: InboundVideoQuality | null
}

/** Opaque, memory-only carry-over needed to compute deltas on the next poll. */
export interface PreviousQualitySample {
  readonly timestampMs: number
  readonly outbound: {
    readonly bytesSent: number | null
    readonly packetsSent: number | null
    readonly framesEncoded: number | null
    readonly remotePacketsLost: number | null
  } | null
  readonly inbound: {
    readonly bytesReceived: number | null
    readonly packetsReceived: number | null
    readonly packetsLost: number | null
    readonly framesDecoded: number | null
  } | null
}

export interface ComputeQualitySnapshotInput {
  report: RTCStatsReport
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  signalingState: RTCSignalingState
  nowMs: number
  previousSample: PreviousQualitySample | null
}

export interface ComputeQualitySnapshotResult {
  snapshot: QualitySnapshot
  nextSample: PreviousQualitySample
}

type StatRecord = Record<string, unknown> & { id?: unknown; type?: unknown }

export function computeQualitySnapshot(
  input: ComputeQualitySnapshotInput,
): ComputeQualitySnapshotResult {
  const stats = toStatRecords(input.report)

  const outboundStat = findFirst(
    stats,
    (stat) => stat.type === 'outbound-rtp' && stat.kind === 'video',
  )
  const remoteInboundStat =
    outboundStat === null
      ? null
      : (getById(stats, outboundStat.remoteId) ??
        findFirst(stats, (stat) => stat.type === 'remote-inbound-rtp' && stat.kind === 'video'))
  const inboundStat = findFirst(
    stats,
    (stat) => stat.type === 'inbound-rtp' && stat.kind === 'video',
  )

  const previousSeconds =
    input.previousSample === null ? null : (input.nowMs - input.previousSample.timestampMs) / 1000
  const deltaSeconds = previousSeconds !== null && previousSeconds > 0 ? previousSeconds : null

  const outboundVideo = buildOutboundVideo(
    stats,
    outboundStat,
    remoteInboundStat,
    input.previousSample?.outbound ?? null,
    deltaSeconds,
  )
  const inboundVideo = buildInboundVideo(
    stats,
    inboundStat,
    input.previousSample?.inbound ?? null,
    deltaSeconds,
  )

  const snapshot: QualitySnapshot = {
    connection: {
      timestampMs: input.nowMs,
      connectionState: input.connectionState,
      iceConnectionState: input.iceConnectionState,
      signalingState: input.signalingState,
      selectedPath: buildSelectedPath(stats),
    },
    outboundVideo,
    inboundVideo,
  }

  const nextSample: PreviousQualitySample = {
    timestampMs: input.nowMs,
    outbound:
      outboundStat === null
        ? null
        : {
            bytesSent: numberOrNull(outboundStat.bytesSent),
            packetsSent: numberOrNull(outboundStat.packetsSent),
            framesEncoded: numberOrNull(outboundStat.framesEncoded),
            remotePacketsLost: numberOrNull(remoteInboundStat?.packetsLost),
          },
    inbound:
      inboundStat === null
        ? null
        : {
            bytesReceived: numberOrNull(inboundStat.bytesReceived),
            packetsReceived: numberOrNull(inboundStat.packetsReceived),
            packetsLost: numberOrNull(inboundStat.packetsLost),
            framesDecoded: numberOrNull(inboundStat.framesDecoded),
          },
  }

  return { snapshot, nextSample }
}

function buildOutboundVideo(
  stats: StatRecord[],
  outboundStat: StatRecord | null,
  remoteInboundStat: StatRecord | null,
  previous: PreviousQualitySample['outbound'],
  deltaSeconds: number | null,
): OutboundVideoQuality | null {
  if (outboundStat === null) {
    return null
  }

  const bytesSent = numberOrNull(outboundStat.bytesSent)
  const packetsSent = numberOrNull(outboundStat.packetsSent)
  const framesEncoded = numberOrNull(outboundStat.framesEncoded)
  const remotePacketsLost = numberOrNull(remoteInboundStat?.packetsLost)

  return {
    codec: resolveCodecName(stats, outboundStat.codecId),
    bytesSent,
    bitrateKbps: calculateBitrateKbps(bytesSent, previous?.bytesSent ?? null, deltaSeconds),
    packetsSent,
    retransmittedPacketsSent: numberOrNull(outboundStat.retransmittedPacketsSent),
    framesEncoded,
    framesSent: numberOrNull(outboundStat.framesSent),
    framesPerSecond: calculateFps(
      numberOrNull(outboundStat.framesPerSecond),
      framesEncoded,
      previous?.framesEncoded ?? null,
      deltaSeconds,
    ),
    keyFramesEncoded: numberOrNull(outboundStat.keyFramesEncoded),
    totalEncodeTimeSeconds: numberOrNull(outboundStat.totalEncodeTime),
    qualityLimitationReason: stringOrNull(outboundStat.qualityLimitationReason),
    qualityLimitationResolutionChanges: numberOrNull(
      outboundStat.qualityLimitationResolutionChanges,
    ),
    packetsLost: remotePacketsLost,
    packetLossPercent: calculateLossPercent(
      remotePacketsLost,
      previous?.remotePacketsLost ?? null,
      packetsSent,
      previous?.packetsSent ?? null,
    ),
    roundTripTimeMs: toMilliseconds(numberOrNull(remoteInboundStat?.roundTripTime)),
    jitterMs: toMilliseconds(numberOrNull(remoteInboundStat?.jitter)),
  }
}

function buildInboundVideo(
  stats: StatRecord[],
  inboundStat: StatRecord | null,
  previous: PreviousQualitySample['inbound'],
  deltaSeconds: number | null,
): InboundVideoQuality | null {
  if (inboundStat === null) {
    return null
  }

  const bytesReceived = numberOrNull(inboundStat.bytesReceived)
  const packetsReceived = numberOrNull(inboundStat.packetsReceived)
  const packetsLost = numberOrNull(inboundStat.packetsLost)
  const framesDecoded = numberOrNull(inboundStat.framesDecoded)

  return {
    codec: resolveCodecName(stats, inboundStat.codecId),
    bytesReceived,
    bitrateKbps: calculateBitrateKbps(bytesReceived, previous?.bytesReceived ?? null, deltaSeconds),
    packetsReceived,
    packetsLost,
    packetLossPercent: calculateLossPercent(
      packetsLost,
      previous?.packetsLost ?? null,
      packetsReceived,
      previous?.packetsReceived ?? null,
    ),
    jitterMs: toMilliseconds(numberOrNull(inboundStat.jitter)),
    framesReceived: numberOrNull(inboundStat.framesReceived),
    framesDecoded,
    framesDropped: numberOrNull(inboundStat.framesDropped),
    framesPerSecond: calculateFps(
      numberOrNull(inboundStat.framesPerSecond),
      framesDecoded,
      previous?.framesDecoded ?? null,
      deltaSeconds,
    ),
  }
}

function buildSelectedPath(stats: StatRecord[]): SelectedIcePath | null {
  const resolved = resolveSelectedPair(stats)
  if (resolved === null) {
    return null
  }

  const { pair, local, remote } = resolved
  return {
    localCandidateType: toCandidateType(local?.candidateType),
    remoteCandidateType: toCandidateType(remote?.candidateType),
    relayProtocol: stringOrNull(local?.relayProtocol),
    transportProtocol: stringOrNull(local?.protocol ?? pair.protocol),
    currentRoundTripTimeMs: toMilliseconds(numberOrNull(pair.currentRoundTripTime)),
    availableOutgoingBitrateKbps: toKbpsFromBps(numberOrNull(pair.availableOutgoingBitrate)),
  }
}

/**
 * Prefers the modern `transport.selectedCandidatePairId` relationship. Falls back to a
 * candidate-pair explicitly flagged `selected`/`nominated`+`succeeded` only when no
 * transport stat is available — never just the first `succeeded` pair encountered, since
 * multiple pairs can reach `succeeded` while only one is actually nominated/selected.
 */
function resolveSelectedPair(
  stats: StatRecord[],
): { pair: StatRecord; local: StatRecord | null; remote: StatRecord | null } | null {
  const transport = findFirst(stats, (stat) => stat.type === 'transport')
  let pair = transport === null ? null : getById(stats, transport.selectedCandidatePairId)

  if (pair === null) {
    pair = findFirst(stats, (stat) => stat.type === 'candidate-pair' && stat.selected === true)
  }

  if (pair === null) {
    pair = findFirst(
      stats,
      (stat) =>
        stat.type === 'candidate-pair' && stat.nominated === true && stat.state === 'succeeded',
    )
  }

  if (pair === null) {
    return null
  }

  return {
    pair,
    local: getById(stats, pair.localCandidateId),
    remote: getById(stats, pair.remoteCandidateId),
  }
}

function resolveCodecName(stats: StatRecord[], codecId: unknown): string | null {
  const mimeType = stringOrNull(getById(stats, codecId)?.mimeType)
  if (mimeType === null) {
    return null
  }

  const [, subtype] = mimeType.split('/')
  return subtype ?? mimeType
}

function calculateBitrateKbps(
  currentBytes: number | null,
  previousBytes: number | null,
  deltaSeconds: number | null,
): number | null {
  if (deltaSeconds === null) {
    return null
  }

  const deltaBytes = safeDelta(currentBytes, previousBytes)
  if (deltaBytes === null) {
    return null
  }

  const bitrateKbps = (deltaBytes * 8) / deltaSeconds / 1000
  return Number.isFinite(bitrateKbps) ? bitrateKbps : null
}

/**
 * Interval (not lifetime) loss percentage, using the standard RTP fraction-lost shape:
 * deltaLost / (deltaLost + deltaOfSuccessfullyAccountedPackets). A lifetime percentage
 * would be misleading for a long session with a single brief bad interval.
 */
function calculateLossPercent(
  currentLost: number | null,
  previousLost: number | null,
  currentOther: number | null,
  previousOther: number | null,
): number | null {
  const deltaLost = safeDelta(currentLost, previousLost)
  const deltaOther = safeDelta(currentOther, previousOther)
  if (deltaLost === null || deltaOther === null) {
    return null
  }

  const denominator = deltaLost + deltaOther
  if (denominator <= 0) {
    return null
  }

  const percent = (deltaLost / denominator) * 100
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null
}

function calculateFps(
  directValue: number | null,
  currentFrames: number | null,
  previousFrames: number | null,
  deltaSeconds: number | null,
): number | null {
  if (directValue !== null) {
    return directValue
  }

  if (deltaSeconds === null) {
    return null
  }

  const deltaFrames = safeDelta(currentFrames, previousFrames)
  if (deltaFrames === null) {
    return null
  }

  const fps = deltaFrames / deltaSeconds
  return Number.isFinite(fps) ? fps : null
}

/** A negative delta (counter reset/rollover) is treated as unavailable, never negative. */
function safeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) {
    return null
  }

  const delta = current - previous
  return delta < 0 ? null : delta
}

function toMilliseconds(seconds: number | null): number | null {
  return seconds === null ? null : seconds * 1000
}

function toKbpsFromBps(bitsPerSecond: number | null): number | null {
  return bitsPerSecond === null ? null : bitsPerSecond / 1000
}

function toCandidateType(value: unknown): CandidateType {
  return value === 'host' || value === 'srflx' || value === 'relay' || value === 'prflx'
    ? value
    : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toStatRecords(report: RTCStatsReport): StatRecord[] {
  const records: StatRecord[] = []
  report.forEach((value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      records.push(value as StatRecord)
    }
  })
  return records
}

function findFirst(
  stats: StatRecord[],
  predicate: (stat: StatRecord) => boolean,
): StatRecord | null {
  return stats.find(predicate) ?? null
}

function getById(stats: StatRecord[], id: unknown): StatRecord | null {
  if (typeof id !== 'string') {
    return null
  }

  return stats.find((stat) => stat.id === id) ?? null
}
