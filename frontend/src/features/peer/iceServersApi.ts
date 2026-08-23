interface IceServersResponseBody {
  iceServers?: unknown
}

export async function fetchRoomIceServers(
  roomId: string,
  credential: string,
  signal?: AbortSignal,
): Promise<RTCIceServer[]> {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/ice-servers`,
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
    throw new Error('The ICE server configuration could not be retrieved.')
  }

  const body = (await response.json()) as IceServersResponseBody
  return validateIceServers(body)
}

function validateIceServers(body: IceServersResponseBody): RTCIceServer[] {
  if (!Array.isArray(body.iceServers)) {
    throw new Error('The ICE server configuration response was invalid.')
  }

  return body.iceServers.map(validateIceServerEntry)
}

function validateIceServerEntry(entry: unknown): RTCIceServer {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('The ICE server configuration response was invalid.')
  }

  const { urls, username, credential } = entry as Record<string, unknown>

  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    !urls.every((url) => typeof url === 'string' && url.length > 0)
  ) {
    throw new Error('The ICE server configuration response was invalid.')
  }

  if (username != null && typeof username !== 'string') {
    throw new Error('The ICE server configuration response was invalid.')
  }

  if (credential != null && typeof credential !== 'string') {
    throw new Error('The ICE server configuration response was invalid.')
  }

  return {
    urls,
    ...(typeof username === 'string' ? { username } : {}),
    ...(typeof credential === 'string' ? { credential } : {}),
  }
}
