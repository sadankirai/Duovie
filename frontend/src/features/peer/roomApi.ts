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

interface ResumedRoomSessionResponse {
  room: {
    id: string
  }
  participant: {
    id: string
    role: ParticipantRole
  }
}

export async function createRoomSession(): Promise<RoomSession> {
  return requestRoomSession('/api/rooms')
}

export async function joinRoomSession(roomId: string): Promise<RoomSession> {
  return requestRoomSession(`/api/rooms/${encodeURIComponent(roomId)}/join`)
}

export async function resumeRoomSession(
  roomId: string,
  credential: string,
  signal?: AbortSignal,
): Promise<RoomSession> {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/session`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
      },
      signal,
    },
  )

  if (!response.ok) {
    throw new Error('The participant session could not be restored.')
  }

  const body = (await response.json()) as ResumedRoomSessionResponse
  if (
    typeof body.room?.id !== 'string' ||
    typeof body.participant?.id !== 'string' ||
    (body.participant.role !== 'Host' && body.participant.role !== 'Guest')
  ) {
    throw new Error('The participant session response was invalid.')
  }

  return {
    roomId: body.room.id,
    participantId: body.participant.id,
    role: body.participant.role,
    credential,
  }
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
