import { useEffect, useRef, useState } from 'react'
import { RoomRuntime, initialRoomRuntimeSnapshot } from '../peer/RoomRuntime'
import type { RoomRuntimeSnapshot } from '../peer/RoomRuntime'
import type { RoomSession } from '../peer/contracts'
import type { RemoteVideoState } from '../peer/WebRtcPeerController'

// Thin React wrapper around the existing RoomRuntime — construction, start()/stop()
// lifecycle and callback wiring only. No changes to RoomRuntime, RoomHubClient,
// WebRtcPeerController, or the SignalR/WebRTC logic they own.
export function useRoomRuntime(session: RoomSession | null) {
  const [snapshot, setSnapshot] = useState<RoomRuntimeSnapshot>(initialRoomRuntimeSnapshot)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remoteState, setRemoteState] = useState<RemoteVideoState>('unavailable')
  const [notice, setNotice] = useState<string | null>(null)
  const runtimeRef = useRef<RoomRuntime | null>(null)

  useEffect(() => {
    if (!session) return
    const runtime = new RoomRuntime(session, {
      onStateChanged: setSnapshot,
      onRemoteVideoChanged: (stream, state) => {
        setRemoteStream(stream)
        setRemoteState(state)
      },
      onNotice: setNotice,
    })
    runtimeRef.current = runtime
    void runtime.start()
    return () => {
      void runtime.stop()
      runtimeRef.current = null
    }
  }, [session])

  return {
    snapshot,
    remoteStream,
    remoteState,
    notice,
    startScreenShare: () => runtimeRef.current?.startScreenShare(),
    stopScreenShare: () => runtimeRef.current?.stopScreenShare(),
  }
}
