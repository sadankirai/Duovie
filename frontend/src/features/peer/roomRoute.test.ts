import { describe, expect, it } from 'vitest'
import {
  buildPeerRoomPath,
  parsePeerRoomRoute,
} from './roomRoute'

describe('peer Room routes', () => {
  it('distinguishes the harness root from a canonical Room locator', () => {
    const roomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'

    expect(parsePeerRoomRoute('/dev/peer')).toEqual({ kind: 'root' })
    expect(parsePeerRoomRoute(`/dev/peer/${roomId.toUpperCase()}`)).toEqual({
      kind: 'room',
      roomId,
    })
    expect(buildPeerRoomPath(roomId)).toBe(`/dev/peer/${roomId}`)
  })

  it('rejects malformed, empty, and extra-segment Room paths', () => {
    expect(parsePeerRoomRoute('/dev/peer/')).toEqual({ kind: 'invalid' })
    expect(parsePeerRoomRoute('/dev/peer/not-a-room')).toEqual({ kind: 'invalid' })
    expect(
      parsePeerRoomRoute('/dev/peer/a3f45d1e-6c6e-4cab-9dc8-246a2bc74995/extra'),
    ).toEqual({ kind: 'invalid' })
  })
})
