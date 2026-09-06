import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import type { RoomSession } from '../peer/contracts'
import { resumeRoomSession } from '../peer/roomApi'
import { browserParticipantCredentialStorage } from '../peer/participantCredentialStorage'

// Shared by Lobby and Room: resolves the RoomSession either from router state
// (freshly created/joined on Dashboard) or by resuming a stored participant
// credential for this roomId — using the existing roomApi/participantCredentialStorage
// exactly as designed, no changes to that logic.
export function useRoomSession() {
  const { roomId } = useParams<{ roomId: string }>()
  const location = useLocation() as { state?: { session?: RoomSession } }
  const [session, setSession] = useState<RoomSession | null>(location.state?.session ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session || !roomId) return
    const credential = browserParticipantCredentialStorage.read(roomId)
    if (!credential) {
      setError('Bu odaya ait geçerli bir oturum bulunamadı.')
      return
    }
    const controller = new AbortController()
    resumeRoomSession(roomId, credential, controller.signal)
      .then(setSession)
      .catch(() => setError('Oturum geri yüklenemedi. Lütfen tekrar katılın.'))
    return () => controller.abort()
  }, [roomId, session])

  useEffect(() => {
    if (session) browserParticipantCredentialStorage.write(session.roomId, session.credential)
  }, [session])

  return { session, roomId, error }
}
