import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readParticipantCredential,
  removeParticipantCredential,
  writeParticipantCredential,
} from './participantCredentialStorage'

const firstRoomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'
const secondRoomId = 'bd7a3863-58d4-4caf-89da-35309f4a6e93'
const credential = 'A'.repeat(43)

describe('participant credential session storage', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores only a version and opaque credential under a Room-bound sessionStorage key', () => {
    const localStorageWrite = vi.spyOn(window.localStorage, 'setItem')

    writeParticipantCredential(window.sessionStorage, firstRoomId, credential)

    expect(readParticipantCredential(window.sessionStorage, firstRoomId)).toBe(credential)
    expect(readParticipantCredential(window.sessionStorage, secondRoomId)).toBeNull()
    expect(window.sessionStorage).toHaveLength(1)
    const storedValue = window.sessionStorage.getItem(window.sessionStorage.key(0)!)!
    expect(JSON.parse(storedValue)).toEqual({ version: 1, credential })
    expect(storedValue).not.toContain('Host')
    expect(storedValue).not.toContain('Guest')
    expect(storedValue).not.toContain('participantId')
    expect(localStorageWrite).not.toHaveBeenCalled()
  })

  it('fails closed and clears malformed or authority-bearing stored values', () => {
    writeParticipantCredential(window.sessionStorage, firstRoomId, credential)
    const key = window.sessionStorage.key(0)!
    window.sessionStorage.setItem(key, '{not-json')

    expect(readParticipantCredential(window.sessionStorage, firstRoomId)).toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()

    window.sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, credential, role: 'Host' }),
    )
    expect(readParticipantCredential(window.sessionStorage, firstRoomId)).toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })

  it('removes only the credential bound to the selected Room', () => {
    writeParticipantCredential(window.sessionStorage, firstRoomId, credential)
    writeParticipantCredential(window.sessionStorage, secondRoomId, 'B'.repeat(43))

    removeParticipantCredential(window.sessionStorage, firstRoomId)

    expect(readParticipantCredential(window.sessionStorage, firstRoomId)).toBeNull()
    expect(readParticipantCredential(window.sessionStorage, secondRoomId)).toBe('B'.repeat(43))
  })
})
