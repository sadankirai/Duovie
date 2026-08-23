import { isValidRoomId } from './roomRoute'

const storageKeyPrefix = 'duovie.participant-session.v1:'
const credentialPattern = /^[A-Za-z0-9_-]{43}$/

interface StoredParticipantCredential {
  version: 1
  credential: string
}

export interface ParticipantCredentialStorage {
  read: (roomId: string) => string | null
  write: (roomId: string, credential: string) => void
  remove: (roomId: string) => void
}

export const browserParticipantCredentialStorage: ParticipantCredentialStorage = {
  read: (roomId) => readParticipantCredential(window.sessionStorage, roomId),
  write: (roomId, credential) =>
    writeParticipantCredential(window.sessionStorage, roomId, credential),
  remove: (roomId) => removeParticipantCredential(window.sessionStorage, roomId),
}

export function readParticipantCredential(
  storage: Storage,
  roomId: string,
): string | null {
  const key = getStorageKey(roomId)

  try {
    const value = storage.getItem(key)
    if (value === null) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<StoredParticipantCredential> | null
    if (
      parsed === null ||
      parsed.version !== 1 ||
      typeof parsed.credential !== 'string' ||
      !credentialPattern.test(parsed.credential) ||
      Object.keys(parsed).some((property) => !['version', 'credential'].includes(property))
    ) {
      storage.removeItem(key)
      return null
    }

    return parsed.credential
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      // Storage cleanup is best-effort; malformed data never grants authority.
    }

    return null
  }
}

export function writeParticipantCredential(
  storage: Storage,
  roomId: string,
  credential: string,
): void {
  if (!credentialPattern.test(credential)) {
    throw new Error('The participant credential cannot be stored.')
  }

  const value: StoredParticipantCredential = { version: 1, credential }
  storage.setItem(getStorageKey(roomId), JSON.stringify(value))
}

export function removeParticipantCredential(storage: Storage, roomId: string): void {
  try {
    storage.removeItem(getStorageKey(roomId))
  } catch {
    // Reset remains safe even when the browser denies storage access.
  }
}

function getStorageKey(roomId: string): string {
  if (!isValidRoomId(roomId)) {
    throw new Error('The Room identifier is invalid.')
  }

  return `${storageKeyPrefix}${roomId.toLowerCase()}`
}
