import { describe, expect, it, vi } from 'vitest'
import {
  applyMotionOptimizedSenderProfile,
  calculateScaleResolutionDownBy,
  motionOptimizedDegradationPreference,
  motionOptimizedMaxBitrateBps,
  motionOptimizedMaxFramerate,
} from './screenShareEncoding'

describe('calculateScaleResolutionDownBy', () => {
  it('scales 1920x1080 down to approximately 1280x720', () => {
    const scale = calculateScaleResolutionDownBy(1920, 1080)

    expect(scale).toBeCloseTo(1.5, 5)
    expect(1920 / scale).toBeCloseTo(1280, 5)
    expect(1080 / scale).toBeCloseTo(720, 5)
  })

  it('scales 2560x1440 down to approximately 1280x720', () => {
    const scale = calculateScaleResolutionDownBy(2560, 1440)

    expect(scale).toBeCloseTo(2, 5)
    expect(2560 / scale).toBeCloseTo(1280, 5)
    expect(1440 / scale).toBeCloseTo(720, 5)
  })

  it('does not downscale a source already at the target envelope', () => {
    expect(calculateScaleResolutionDownBy(1280, 720)).toBe(1)
  })

  it('never upscales a source smaller than the target envelope', () => {
    expect(calculateScaleResolutionDownBy(640, 360)).toBe(1)
    expect(calculateScaleResolutionDownBy(800, 600)).toBe(1)
  })

  it('preserves aspect ratio for a non-16:9 source', () => {
    // 4:3 source taller than the 720 envelope height but narrower than the 1280 width.
    const scale = calculateScaleResolutionDownBy(1024, 768)

    expect(scale).toBeCloseTo(768 / 720, 5)
    expect(1024 / scale).toBeCloseTo(1024 / (768 / 720), 5)
    // Aspect ratio is preserved: encoded width/height ratio matches the source's.
    expect((1024 / scale) / (768 / scale)).toBeCloseTo(1024 / 768, 5)
  })

  it('safely uses neutral (no) scaling when width/height are missing or invalid', () => {
    expect(calculateScaleResolutionDownBy(undefined, undefined)).toBe(1)
    expect(calculateScaleResolutionDownBy(null, null)).toBe(1)
    expect(calculateScaleResolutionDownBy(0, 0)).toBe(1)
    expect(calculateScaleResolutionDownBy(-1920, -1080)).toBe(1)
    expect(calculateScaleResolutionDownBy(Number.NaN, 1080)).toBe(1)
    expect(calculateScaleResolutionDownBy(1920, Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('never produces NaN or Infinity for extreme inputs', () => {
    const values = [
      calculateScaleResolutionDownBy(1, 1),
      calculateScaleResolutionDownBy(100_000, 100_000),
      calculateScaleResolutionDownBy(1, 100_000),
      calculateScaleResolutionDownBy(100_000, 1),
    ]

    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true)
      expect(Number.isNaN(value)).toBe(false)
    }
  })
})

describe('applyMotionOptimizedSenderProfile', () => {
  it('sets contentHint to "motion" on the screen-share track when supported', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })

    await applyMotionOptimizedSenderProfile(sender, track)

    expect(track.contentHint).toBe('motion')
  })

  it('does not fail the share when contentHint assignment throws', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })
    Object.defineProperty(track, 'contentHint', {
      configurable: true,
      set() {
        throw new Error('unsupported in this browser')
      },
      get() {
        return ''
      },
    })

    await expect(applyMotionOptimizedSenderProfile(sender, track)).resolves.toBeUndefined()
    expect(sender.setParametersCalls).toHaveLength(1)
  })

  it('sets maxFramerate to 30 on the sender encoding', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })

    await applyMotionOptimizedSenderProfile(sender, track)

    expect(sender.setParametersCalls[0]?.encodings?.[0]?.maxFramerate).toBe(
      motionOptimizedMaxFramerate,
    )
  })

  it('sets the chosen maxBitrate ceiling on the sender encoding', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })

    await applyMotionOptimizedSenderProfile(sender, track)

    expect(sender.setParametersCalls[0]?.encodings?.[0]?.maxBitrate).toBe(
      motionOptimizedMaxBitrateBps,
    )
  })

  it('attempts degradationPreference "maintain-framerate"', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })

    await applyMotionOptimizedSenderProfile(sender, track)

    expect(sender.setParametersCalls[0]?.degradationPreference).toBe(
      motionOptimizedDegradationPreference,
    )
  })

  it('does not fail screen sharing when setParameters is unsupported/rejects', async () => {
    const sender = fakeSender()
    sender.setParametersError = new Error('setParameters not supported')
    const track = fakeTrack({ width: 1920, height: 1080 })

    await expect(applyMotionOptimizedSenderProfile(sender, track)).resolves.toBeUndefined()
  })

  it('recalculates scaling from the current track settings each call (repeat share)', async () => {
    const sender = fakeSender()

    await applyMotionOptimizedSenderProfile(sender, fakeTrack({ width: 1920, height: 1080 }))
    expect(sender.setParametersCalls[0]?.encodings?.[0]?.scaleResolutionDownBy).toBeCloseTo(
      1.5,
      5,
    )

    await applyMotionOptimizedSenderProfile(sender, fakeTrack({ width: 1280, height: 720 }))
    expect(sender.setParametersCalls[1]?.encodings?.[0]?.scaleResolutionDownBy).toBe(1)
  })

  it('handles a track that has no getSettings by using neutral scaling', async () => {
    const sender = fakeSender()
    const track = fakeTrack({ width: 1920, height: 1080 })
    // @ts-expect-error simulating a browser without getSettings
    track.getSettings = undefined

    await expect(applyMotionOptimizedSenderProfile(sender, track)).resolves.toBeUndefined()
    expect(sender.setParametersCalls[0]?.encodings?.[0]?.scaleResolutionDownBy).toBe(1)
  })
})

interface FakeSender {
  getParametersCallCount: number
  setParametersCalls: RTCRtpSendParameters[]
  setParametersError: Error | null
  getParameters(): RTCRtpSendParameters
  setParameters(parameters: RTCRtpSendParameters): Promise<void>
}

function fakeSender(): FakeSender & RTCRtpSender {
  const sender: FakeSender = {
    getParametersCallCount: 0,
    setParametersCalls: [],
    setParametersError: null,
    getParameters(): RTCRtpSendParameters {
      sender.getParametersCallCount += 1
      return { encodings: [{}] } as unknown as RTCRtpSendParameters
    },
    async setParameters(parameters: RTCRtpSendParameters): Promise<void> {
      sender.setParametersCalls.push(parameters)
      if (sender.setParametersError !== null) {
        throw sender.setParametersError
      }
    },
  }

  return sender as unknown as FakeSender & RTCRtpSender
}

function fakeTrack(settings: { width?: number; height?: number }): MediaStreamTrack {
  const track = {
    contentHint: '',
    getSettings: vi.fn(() => settings as MediaTrackSettings),
  }

  return track as unknown as MediaStreamTrack
}
