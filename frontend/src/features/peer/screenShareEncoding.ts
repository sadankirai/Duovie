/**
 * Motion-optimized Host screen-share encoding baseline (Stage 7.2).
 *
 * Real cross-network acceptance (Mac Host on Wi-Fi, phone Guest on cellular, direct
 * srflx↔srflx P2P, 0% packet loss, low jitter, stable 30 FPS) showed
 * `qualityLimitationReason: "bandwidth"` at ~1.6 Mbps send / ~1.4 Mbps receive while
 * sending the native captured resolution with no explicit encoding policy — moving
 * content periodically went blurry with occasional stutter. This module targets a
 * conservative ~720p30 motion baseline via `RTCRtpSender` encoding parameters only
 * (`scaleResolutionDownBy`, never DOM/canvas resizing or renegotiation), preferring
 * smooth motion over native resolution when the network is constrained.
 *
 * This is an observability-informed baseline, not an adaptive-quality system: the
 * profile is fixed and applied once per capture. Congestion control remains
 * authoritative — `maxBitrate` is a ceiling only, never a guaranteed/minimum bitrate,
 * and this module never touches SDP directly.
 */

export const motionOptimizedTargetWidth = 1280
export const motionOptimizedTargetHeight = 720
export const motionOptimizedMaxFramerate = 30

/**
 * 3.5 Mbps: the midpoint of the task's suggested 3.0–4.0 Mbps range for a 720p30
 * motion baseline. It gives real-world congestion control (observed ~1.6 Mbps on a
 * constrained cellular path) comfortable headroom to grow toward on a better network,
 * while still being a sane application-level cap rather than an unbounded encode.
 */
export const motionOptimizedMaxBitrateBps = 3_500_000
export const motionOptimizedDegradationPreference: RTCDegradationPreference =
  'maintain-framerate'

/**
 * Bounding-box downscale factor that fits `width`×`height` within the motion-optimized
 * target envelope while preserving aspect ratio (works for any aspect ratio, not just
 * 16:9). Never upscales (minimum result is `1`) and never returns a non-finite value —
 * missing/invalid dimensions safely resolve to the neutral scale `1`.
 */
export function calculateScaleResolutionDownBy(
  width: number | null | undefined,
  height: number | null | undefined,
): number {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1
  }

  const scale = Math.max(
    1,
    width / motionOptimizedTargetWidth,
    height / motionOptimizedTargetHeight,
  )

  return Number.isFinite(scale) ? scale : 1
}

/**
 * Best-effort application of the motion-optimized profile to the Host's pre-negotiated
 * video sender/track. Never throws and never renegotiates: a `contentHint` assignment
 * failure, a missing `getParameters`/`setParameters`/`getSettings`, or a `setParameters`
 * rejection (unsupported field, browser quirk) all degrade silently to today's plain
 * screen-share behavior instead of failing the share.
 */
export async function applyMotionOptimizedSenderProfile(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
): Promise<void> {
  try {
    if ('contentHint' in track) {
      track.contentHint = 'motion'
    }
  } catch {
    // Unsupported/failed contentHint assignment must never fail sharing.
  }

  try {
    const settings =
      typeof track.getSettings === 'function' ? track.getSettings() : {}
    const scaleResolutionDownBy = calculateScaleResolutionDownBy(
      settings.width,
      settings.height,
    )

    const parameters = sender.getParameters()
    const encodings =
      Array.isArray(parameters.encodings) && parameters.encodings.length > 0
        ? parameters.encodings
        : [{}]
    encodings[0].scaleResolutionDownBy = scaleResolutionDownBy
    encodings[0].maxFramerate = motionOptimizedMaxFramerate
    encodings[0].maxBitrate = motionOptimizedMaxBitrateBps
    parameters.encodings = encodings
    parameters.degradationPreference = motionOptimizedDegradationPreference

    await sender.setParameters(parameters)
  } catch {
    // Unsupported/failed sender-parameter application must never fail sharing; the
    // share continues at the browser's default encoding behavior.
  }
}
