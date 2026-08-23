import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuestRemoteVideo } from './PeerDevelopmentHarness'

describe('GuestRemoteVideo', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hides a retained frozen stream while inactive and reuses it when sharing resumes', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const stream = {} as MediaStream
    const { rerender, unmount } = render(
      <GuestRemoteVideo active stream={stream} />,
    )
    const video = screen.getByLabelText('Host shared display') as HTMLVideoElement

    await waitFor(() => expect(video.srcObject).toBe(stream))
    expect(video).not.toHaveAttribute('hidden')
    expect(play).toHaveBeenCalledTimes(1)

    rerender(<GuestRemoteVideo active={false} stream={stream} />)

    expect(video).toHaveAttribute('hidden')
    expect(screen.getByText('Host is not sharing.')).toBeInTheDocument()
    expect(video.srcObject).toBe(stream)

    rerender(<GuestRemoteVideo active stream={stream} />)

    expect(video).not.toHaveAttribute('hidden')
    expect(screen.queryByText('Host is not sharing.')).not.toBeInTheDocument()
    expect(video.srcObject).toBe(stream)
    expect(play).toHaveBeenCalledTimes(1)

    unmount()
    expect(video.srcObject).toBeNull()
  })
})
