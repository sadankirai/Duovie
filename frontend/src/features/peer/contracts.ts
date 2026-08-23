export type ParticipantRole = 'Host' | 'Guest'

export interface RoomSession {
  roomId: string
  participantId: string
  role: ParticipantRole
  credential: string
}

export interface RoomPresenceParticipant {
  participantId: string
  role: ParticipantRole
  connected: boolean
}

export interface RoomPresenceSnapshot {
  participants: RoomPresenceParticipant[]
}

export interface RoomWebRtcOffer {
  participantId: string
  role: ParticipantRole
  sdp: string
}

export interface RoomWebRtcAnswer {
  participantId: string
  role: ParticipantRole
  sdp: string
}

export interface RoomIceCandidate {
  participantId: string
  role: ParticipantRole
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

export interface RoomWebRtcRecoveryRequested {
  participantId: string
  role: ParticipantRole
}

export interface RoomScreenShareStateChanged {
  participantId: string
  role: 'Host'
  active: boolean
}

export interface PeerConnectionStatus {
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  iceGatheringState: RTCIceGatheringState
  signalingState: RTCSignalingState
}

export const initialPeerConnectionStatus: PeerConnectionStatus = {
  connectionState: 'new',
  iceConnectionState: 'new',
  iceGatheringState: 'new',
  signalingState: 'stable',
}

export const roomHubEvents = {
  presenceSnapshot: 'RoomPresenceSnapshot',
  presenceChanged: 'RoomPresenceChanged',
  webRtcOffer: 'RoomWebRtcOffer',
  webRtcAnswer: 'RoomWebRtcAnswer',
  iceCandidate: 'RoomIceCandidate',
  webRtcRecoveryRequested: 'RoomWebRtcRecoveryRequested',
  screenShareStateChanged: 'RoomScreenShareStateChanged',
} as const

export const roomHubMethods = {
  sendWebRtcOffer: 'SendWebRtcOffer',
  sendWebRtcAnswer: 'SendWebRtcAnswer',
  sendIceCandidate: 'SendIceCandidate',
  requestWebRtcRecovery: 'RequestWebRtcRecovery',
  sendScreenShareState: 'SendScreenShareState',
} as const
