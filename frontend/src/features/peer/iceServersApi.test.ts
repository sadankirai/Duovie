import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRoomIceServers } from './iceServersApi'

describe('Room ICE server configuration API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the opaque credential only in the Authorization header, never in the URL', async () => {
    const roomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'
    const credential = 'A'.repeat(43)
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.example.com:3478'] },
            {
              urls: ['turn:turn.example.com:3478'],
              username: 'short-lived-username',
              credential: 'short-lived-credential',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const iceServers = await fetchRoomIceServers(roomId, credential)

    expect(iceServers).toEqual([
      { urls: ['stun:stun.example.com:3478'] },
      {
        urls: ['turn:turn.example.com:3478'],
        username: 'short-lived-username',
        credential: 'short-lived-credential',
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      `/api/rooms/${roomId}/ice-servers`,
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

  it('never persists the returned ICE/TURN configuration to browser storage', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ['turn:turn.example.com:3478'],
              username: 'short-lived-username',
              credential: 'short-lived-credential',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'setItem')

    await fetchRoomIceServers('room-id', 'A'.repeat(43))

    expect(sessionStorageSpy).not.toHaveBeenCalled()
    sessionStorageSpy.mockRestore()
  })

  it('treats a missing or null username/credential as absent', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [{ urls: ['stun:stun.example.com:3478'], username: null, credential: null }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const iceServers = await fetchRoomIceServers('room-id', 'A'.repeat(43))

    expect(iceServers).toEqual([{ urls: ['stun:stun.example.com:3478'] }])
  })

  it('rejects a failed request and malformed response shapes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ iceServers: 'not-an-array' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ iceServers: [{ urls: [] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchRoomIceServers('room-id', 'A'.repeat(43))).rejects.toThrow(
      'could not be retrieved',
    )
    await expect(fetchRoomIceServers('room-id', 'A'.repeat(43))).rejects.toThrow(
      'response was invalid',
    )
    await expect(fetchRoomIceServers('room-id', 'A'.repeat(43))).rejects.toThrow(
      'response was invalid',
    )
  })
})
