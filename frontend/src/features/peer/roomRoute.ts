const peerRootPath = '/dev/peer'
const roomIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PeerRoomRoute =
  | { kind: 'root' }
  | { kind: 'room'; roomId: string }
  | { kind: 'invalid' }

export function parsePeerRoomRoute(pathname: string): PeerRoomRoute {
  if (pathname === peerRootPath) {
    return { kind: 'root' }
  }

  const prefix = `${peerRootPath}/`
  if (!pathname.startsWith(prefix)) {
    return { kind: 'invalid' }
  }

  const roomId = pathname.slice(prefix.length)
  return isValidRoomId(roomId)
    ? { kind: 'room', roomId: roomId.toLowerCase() }
    : { kind: 'invalid' }
}

export function isPeerDevelopmentPath(pathname: string): boolean {
  return pathname === peerRootPath || pathname.startsWith(`${peerRootPath}/`)
}

export function buildPeerRoomPath(roomId: string): string {
  if (!isValidRoomId(roomId)) {
    throw new Error('The Room identifier is invalid.')
  }

  return `${peerRootPath}/${roomId.toLowerCase()}`
}

export function buildPeerRootPath(): string {
  return peerRootPath
}

export function isValidRoomId(roomId: string): boolean {
  return roomIdPattern.test(roomId)
}
