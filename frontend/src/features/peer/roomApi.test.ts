import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeRoomSession } from './roomApi'

describe('Room session resume API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the opaque credential only in Authorization and uses canonical response identity', async () => {
    const roomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'
    const participantId = 'ec71c4ae-dbc9-4fb4-94bd-acbfeb04389a'
    const credential = 'A'.repeat(43)
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          room: { id: roomId },
          participant: { id: participantId, role: 'Guest' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const resumed = await resumeRoomSession(roomId, credential)

    expect(resumed).toEqual({ roomId, participantId, role: 'Guest', credential })
    expect(fetch).toHaveBeenCalledWith(
      `/api/rooms/${roomId}/session`,
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential}`,
        },
      }),
    )
    expect(fetch.mock.calls[0][0]).not.toContain(credential)
  })

  it('rejects failed validation and malformed canonical identity responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            room: { id: 'room' },
            participant: { id: 'participant', role: 'cached-role' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(resumeRoomSession('room', 'A'.repeat(43))).rejects.toThrow(
      'could not be restored',
    )
    await expect(resumeRoomSession('room', 'A'.repeat(43))).rejects.toThrow(
      'response was invalid',
    )
  })
})
