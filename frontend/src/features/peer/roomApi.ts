import type { ParticipantRole, RoomSession } from './contracts'

interface RoomSessionResponse {
  room: {
    id: string
    status: string
    expiresAtUtc: string
  }
  participant: {
    id: string
    role: ParticipantRole
    credential: string
    expiresAtUtc: string
  }
}

export async function createRoomSession(): Promise<RoomSession> {
  return requestRoomSession('/api/rooms')
}

export async function joinRoomSession(roomId: string): Promise<RoomSession> {
  return requestRoomSession(`/api/rooms/${encodeURIComponent(roomId)}/join`)
}

async function requestRoomSession(path: string): Promise<RoomSession> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('The Room request was rejected.')
  }

  const body = (await response.json()) as RoomSessionResponse

  return {
    roomId: body.room.id,
    participantId: body.participant.id,
    role: body.participant.role,
    credential: body.participant.credential,
  }
}
