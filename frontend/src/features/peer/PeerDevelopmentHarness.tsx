import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RoomPresenceParticipant, RoomSession } from './contracts'
import {
  initialRoomRuntimeSnapshot,
  RoomRuntime,
  type RoomRuntimeCallbacks,
  type RoomRuntimeSnapshot,
} from './RoomRuntime'
import { createRoomSession, joinRoomSession, resumeRoomSession } from './roomApi'
import {
  browserParticipantCredentialStorage,
  type ParticipantCredentialStorage,
} from './participantCredentialStorage'
import {
  buildPeerRoomPath,
  buildPeerRootPath,
  isPeerDevelopmentPath,
  parsePeerRoomRoute,
} from './roomRoute'
import { isWebRtcPeerConnectionSupported } from './WebRtcPeerController'
import type { SelectedIcePath } from './qualitySnapshot'

export interface RoomRuntimeController {
  start: () => Promise<void>
  stop: () => Promise<void>
  startScreenShare: () => Promise<void>
  stopScreenShare: () => Promise<void>
  restartPeerForDiagnostics: () => void
  disconnectHubForDiagnostics: () => Promise<void>
  reconnectHubForDiagnostics: () => Promise<void>
}

export interface PeerHarnessDependencies {
  createRoomSession: () => Promise<RoomSession>
  joinRoomSession: (roomId: string) => Promise<RoomSession>
  resumeRoomSession: (
    roomId: string,
    credential: string,
    signal?: AbortSignal,
  ) => Promise<RoomSession>
  participantCredentialStorage: ParticipantCredentialStorage
  createRoomRuntime: (
    session: RoomSession,
    callbacks: RoomRuntimeCallbacks,
  ) => RoomRuntimeController
}

const defaultDependencies: PeerHarnessDependencies = {
  createRoomSession,
  joinRoomSession,
  resumeRoomSession,
  participantCredentialStorage: browserParticipantCredentialStorage,
  createRoomRuntime: (session, callbacks) => new RoomRuntime(session, callbacks),
}

export function PeerDevelopmentHarness({
  dependencies = defaultDependencies,
}: {
  dependencies?: PeerHarnessDependencies
}) {
  const [joinRoomId, setJoinRoomId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [session, setSession] = useState<RoomSession | null>(null)
  const [runtimeState, setRuntimeState] = useState<RoomRuntimeSnapshot>(
    initialRoomRuntimeSnapshot,
  )
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const runtimeRef = useRef<RoomRuntimeController | null>(null)
  const routeGenerationRef = useRef(0)
  const restoreAbortRef = useRef<AbortController | null>(null)
  const webRtcSupported = isWebRtcPeerConnectionSupported()

  const clearRuntimeProjection = useCallback(() => {
    setRuntimeState({
      ...initialRoomRuntimeSnapshot,
      presence: [],
      peerStatus: { ...initialRoomRuntimeSnapshot.peerStatus },
    })
    setRemoteVideoStream(null)
  }, [])

  const disposeRuntime = useCallback(async () => {
    const runtime = runtimeRef.current
    runtimeRef.current = null
    if (runtime !== null) {
      await runtime.stop().catch(() => undefined)
    }
    clearRuntimeProjection()
  }, [clearRuntimeProjection])

  const showSessionlessRoute = useCallback(
    (roomId: string | null, routeMessage: string | null = null) => {
      setSession(null)
      setSelectedRoomId(roomId)
      setJoinRoomId(roomId ?? '')
      clearRuntimeProjection()
      setMessage(routeMessage)
    },
    [clearRuntimeProjection],
  )

  const connectSession = useCallback(
    async (roomSession: RoomSession, expectedGeneration: number): Promise<boolean> => {
      if (routeGenerationRef.current !== expectedGeneration) {
        return false
      }

      setSession(roomSession)
      setSelectedRoomId(roomSession.roomId)
      setJoinRoomId(roomSession.roomId)
      clearRuntimeProjection()

      let runtime: RoomRuntimeController | null = null
      const isCurrentRuntime = () =>
        runtime !== null &&
        runtimeRef.current === runtime &&
        routeGenerationRef.current === expectedGeneration
      runtime = dependencies.createRoomRuntime(roomSession, {
        onStateChanged: (snapshot) => {
          if (isCurrentRuntime()) {
            setRuntimeState(snapshot)
          }
        },
        onRemoteVideoChanged: (stream) => {
          if (isCurrentRuntime()) {
            setRemoteVideoStream(stream)
          }
        },
        onNotice: (notice) => {
          if (isCurrentRuntime()) {
            setMessage(notice)
          }
        },
      })
      runtimeRef.current = runtime

      await runtime.start()
      if (!isCurrentRuntime()) {
        if (runtimeRef.current === runtime) {
          runtimeRef.current = null
        }
        await runtime.stop().catch(() => undefined)
        return false
      }

      return true
    },
    [clearRuntimeProjection, dependencies],
  )

  const bootstrapRoute = useCallback(
    async (pathname: string) => {
      const generation = ++routeGenerationRef.current
      restoreAbortRef.current?.abort()
      const abortController = new AbortController()
      restoreAbortRef.current = abortController

      if (
        window.location.pathname === pathname &&
        (window.location.search !== '' ||
          window.location.hash !== '' ||
          window.history.state !== null)
      ) {
        window.history.replaceState(null, '', pathname)
      }

      await disposeRuntime()
      if (routeGenerationRef.current !== generation) {
        return
      }

      const route = parsePeerRoomRoute(pathname)
      if (route.kind === 'invalid') {
        if (isPeerDevelopmentPath(pathname)) {
          window.history.replaceState(null, '', buildPeerRootPath())
          showSessionlessRoute(null, 'The Room URL was invalid and was cleared safely.')
        } else {
          showSessionlessRoute(null)
        }
        setBusy(false)
        return
      }

      if (route.kind === 'root') {
        showSessionlessRoute(null)
        setBusy(false)
        return
      }

      showSessionlessRoute(route.roomId)
      const credential = dependencies.participantCredentialStorage.read(route.roomId)
      if (credential === null) {
        setBusy(false)
        return
      }

      setBusy(true)
      let restoredSession: RoomSession
      try {
        restoredSession = await dependencies.resumeRoomSession(
          route.roomId,
          credential,
          abortController.signal,
        )
      } catch {
        if (abortController.signal.aborted || routeGenerationRef.current !== generation) {
          return
        }

        dependencies.participantCredentialStorage.remove(route.roomId)
        showSessionlessRoute(
          route.roomId,
          'The stored participant session is no longer usable. Join the Room again.',
        )
        setBusy(false)
        return
      }

      if (abortController.signal.aborted || routeGenerationRef.current !== generation) {
        return
      }

      if (restoredSession.roomId.toLowerCase() !== route.roomId) {
        dependencies.participantCredentialStorage.remove(route.roomId)
        showSessionlessRoute(
          route.roomId,
          'The stored participant session could not be bound to this Room.',
        )
        setBusy(false)
        return
      }

      try {
        await connectSession({ ...restoredSession, credential }, generation)
      } catch {
        if (routeGenerationRef.current === generation) {
          await disposeRuntime()
          showSessionlessRoute(
            route.roomId,
            'The participant session was valid, but the Room runtime could not start.',
          )
        }
      } finally {
        if (routeGenerationRef.current === generation) {
          setBusy(false)
        }
      }
    },
    [connectSession, dependencies, disposeRuntime, showSessionlessRoute],
  )

  const activateIssuedSession = useCallback(
    async (roomSession: RoomSession, actionGeneration: number) => {
      if (routeGenerationRef.current !== actionGeneration) {
        return false
      }

      dependencies.participantCredentialStorage.write(
        roomSession.roomId,
        roomSession.credential,
      )
      restoreAbortRef.current?.abort()
      const generation = ++routeGenerationRef.current
      const roomPath = buildPeerRoomPath(roomSession.roomId)
      if (window.location.pathname === roomPath) {
        window.history.replaceState(null, '', roomPath)
      } else {
        window.history.pushState(null, '', roomPath)
      }

      return connectSession(roomSession, generation)
    },
    [connectSession, dependencies],
  )

  const resetSession = useCallback(async () => {
    const roomId = session?.roomId ?? selectedRoomId
    ++routeGenerationRef.current
    restoreAbortRef.current?.abort()
    if (roomId !== null) {
      dependencies.participantCredentialStorage.remove(roomId)
    }

    setBusy(true)
    try {
      await disposeRuntime()
    } finally {
      window.history.pushState(null, '', buildPeerRootPath())
      showSessionlessRoute(null)
      setBusy(false)
    }
  }, [dependencies, disposeRuntime, selectedRoomId, session, showSessionlessRoute])

  const invalidateRouteOwnership = useCallback(() => {
    ++routeGenerationRef.current
    restoreAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    let active = true
    const handlePopState = () => {
      void bootstrapRoute(window.location.pathname)
    }

    window.addEventListener('popstate', handlePopState)
    queueMicrotask(() => {
      if (active) {
        void bootstrapRoute(window.location.pathname)
      }
    })

    return () => {
      active = false
      window.removeEventListener('popstate', handlePopState)
      invalidateRouteOwnership()
      const runtime = runtimeRef.current
      runtimeRef.current = null
      if (runtime !== null) {
        void runtime.stop().catch(() => undefined)
      }
    }
  }, [bootstrapRoute, invalidateRouteOwnership])

  const createRoom = async () => {
    const actionGeneration = routeGenerationRef.current
    setBusy(true)
    setMessage(null)
    try {
      const roomSession = await dependencies.createRoomSession()
      await activateIssuedSession(roomSession, actionGeneration)
    } catch {
      await disposeRuntime()
      setSession(null)
      setMessage('The Host session could not be created or connected.')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault()
    const roomId = selectedRoomId ?? joinRoomId.trim()
    if (!roomId) {
      setMessage('Enter a Room ID to join.')
      return
    }

    const actionGeneration = routeGenerationRef.current
    setBusy(true)
    setMessage(null)
    try {
      const roomSession = await dependencies.joinRoomSession(roomId)
      await activateIssuedSession(roomSession, actionGeneration)
    } catch {
      await disposeRuntime()
      setSession(null)
      setMessage('The Guest session could not be created or connected.')
    } finally {
      setBusy(false)
    }
  }

  const shareScreen = async () => {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }

    setMessage(null)
    try {
      await runtime.startScreenShare()
    } catch {
      if (runtimeRef.current === runtime) {
        setMessage('Screen sharing did not start. You can try again explicitly.')
      }
    }
  }

  const stopScreenSharing = async () => {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }

    setMessage(null)
    try {
      await runtime.stopScreenShare()
    } catch {
      if (runtimeRef.current === runtime) {
        setMessage('Screen sharing stopped, but browser cleanup reported a safe failure.')
      }
    }
  }

  const copyRoomUrl = async () => {
    if (session === null) {
      return
    }

    try {
      await navigator.clipboard.writeText(window.location.href)
      setMessage('Room URL copied. It contains no participant credential.')
    } catch {
      setMessage('Copy failed. Select the Room URL from the address bar.')
    }
  }

  const runtimeStatusText = runtimeStatusMessage(runtimeState.runtimeStatus, session?.role)
  const shareReady =
    session?.role === 'Host' &&
    runtimeState.runtimeStatus === 'connected' &&
    runtimeState.peerStatus.connectionState === 'connected' &&
    runtimeState.peerStatus.signalingState === 'stable'

  return (
    <main className="peer-harness">
      <header>
        <h1>Duovie peer development harness</h1>
        <p>Automatic P2P with Host-only display video. No audio.</p>
      </header>

      {!webRtcSupported && (
        <p role="alert" className="peer-message">
          This browser does not support the standard RTCPeerConnection API.
        </p>
      )}

      {message !== null && <p role="status" className="peer-message">{message}</p>}

      {session === null ? (
        <section className="peer-entry" aria-label="Room session setup">
          {selectedRoomId === null ? (
            <>
              <div>
                <h2>Host</h2>
                <button type="button" disabled={busy} onClick={() => void createRoom()}>
                  Create Room
                </button>
              </div>
              <form onSubmit={(event) => void joinRoom(event)}>
                <h2>Guest</h2>
                <label htmlFor="room-id">Room ID</label>
                <input
                  id="room-id"
                  value={joinRoomId}
                  onChange={(event) => setJoinRoomId(event.target.value)}
                  autoComplete="off"
                />
                <button type="submit" disabled={busy}>Join Room</button>
              </form>
            </>
          ) : (
            <form onSubmit={(event) => void joinRoom(event)}>
              <h2>Join Room</h2>
              <span className="peer-label">Room ID</span>
              <output>{selectedRoomId}</output>
              <p>This URL identifies the Room but grants no participant authority.</p>
              <button type="submit" disabled={busy}>Join Room</button>
            </form>
          )}
        </section>
      ) : (
        <section className="peer-session" aria-label="Active peer session">
          <div className="room-identity">
            <div>
              <span className="peer-label">Role</span>
              <strong>{session.role}</strong>
            </div>
            <div>
              <span className="peer-label">Room ID</span>
              <output>{session.roomId}</output>
            </div>
            <button type="button" onClick={() => void copyRoomUrl()}>Copy Room URL</button>
          </div>

          <p role="status" className="peer-message">{runtimeStatusText}</p>

          <div className="peer-grid">
            <section>
              <h2>Room Hub</h2>
              <dl>
                <StateRow label="Connection" value={runtimeState.hubStatus} />
                <StateRow label="Host presence" value={presenceState(runtimeState.presence, 'Host')} />
                <StateRow label="Guest presence" value={presenceState(runtimeState.presence, 'Guest')} />
              </dl>
            </section>
            <section>
              <h2>WebRTC peer</h2>
              <dl>
                <StateRow label="Runtime" value={runtimeState.runtimeStatus} />
                <StateRow label="Connection" value={runtimeState.peerStatus.connectionState} />
                <StateRow label="ICE connection" value={runtimeState.peerStatus.iceConnectionState} />
                <StateRow label="ICE gathering" value={runtimeState.peerStatus.iceGatheringState} />
                <StateRow label="Signaling" value={runtimeState.peerStatus.signalingState} />
                {session.role === 'Host' && (
                  <>
                    <StateRow label="Video sender track" value={runtimeState.hostSenderTrackState} />
                    <StateRow label="Screen share" value={runtimeState.screenShareState} />
                  </>
                )}
                {session.role === 'Guest' && (
                  <StateRow
                    label="Remote video"
                    value={
                      runtimeState.hostScreenShareActive
                        ? runtimeState.remoteVideoState === 'unavailable'
                          ? 'waiting'
                          : runtimeState.remoteVideoState
                        : 'not sharing'
                    }
                  />
                )}
              </dl>
              {session.role === 'Guest' && (
                <GuestRemoteVideo
                  active={runtimeState.hostScreenShareActive}
                  stream={remoteVideoStream}
                />
              )}
            </section>
            <section>
              <h2>Connection Quality</h2>
              <dl>
                <StateRow
                  label="ICE path"
                  value={formatIcePath(runtimeState.qualitySnapshot?.connection.selectedPath ?? null)}
                />
                <StateRow
                  label="Transport"
                  value={formatTransport(runtimeState.qualitySnapshot?.connection.selectedPath ?? null)}
                />
                <StateRow
                  label="RTT"
                  value={formatMilliseconds(
                    runtimeState.qualitySnapshot?.connection.selectedPath?.currentRoundTripTimeMs ?? null,
                  )}
                />
                {session.role === 'Host' && (
                  <>
                    <StateRow
                      label="Send bitrate"
                      value={formatBitrate(runtimeState.qualitySnapshot?.outboundVideo?.bitrateKbps ?? null)}
                    />
                    <StateRow
                      label="FPS"
                      value={formatFps(runtimeState.qualitySnapshot?.outboundVideo?.framesPerSecond ?? null)}
                    />
                    <StateRow
                      label="Packet loss"
                      value={formatPercent(runtimeState.qualitySnapshot?.outboundVideo?.packetLossPercent ?? null)}
                    />
                    <StateRow
                      label="Quality limitation"
                      value={runtimeState.qualitySnapshot?.outboundVideo?.qualityLimitationReason ?? '—'}
                    />
                    <StateRow
                      label="Codec"
                      value={runtimeState.qualitySnapshot?.outboundVideo?.codec ?? '—'}
                    />
                  </>
                )}
                {session.role === 'Guest' && (
                  <>
                    <StateRow
                      label="Receive bitrate"
                      value={formatBitrate(runtimeState.qualitySnapshot?.inboundVideo?.bitrateKbps ?? null)}
                    />
                    <StateRow
                      label="FPS"
                      value={formatFps(runtimeState.qualitySnapshot?.inboundVideo?.framesPerSecond ?? null)}
                    />
                    <StateRow
                      label="Frames dropped"
                      value={formatCount(runtimeState.qualitySnapshot?.inboundVideo?.framesDropped ?? null)}
                    />
                    <StateRow
                      label="Packet loss"
                      value={formatPercent(runtimeState.qualitySnapshot?.inboundVideo?.packetLossPercent ?? null)}
                    />
                    <StateRow
                      label="Jitter"
                      value={formatMilliseconds(runtimeState.qualitySnapshot?.inboundVideo?.jitterMs ?? null)}
                    />
                    <StateRow
                      label="Codec"
                      value={runtimeState.qualitySnapshot?.inboundVideo?.codec ?? '—'}
                    />
                  </>
                )}
              </dl>
            </section>
          </div>

          <div className="peer-actions">
            {session.role === 'Host' && (
              <>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !shareReady ||
                    runtimeState.displayCaptureRequestPending ||
                    runtimeState.screenShareState !== 'inactive'
                  }
                  onClick={() => void shareScreen()}
                >
                  Share Screen
                </button>
                <button
                  type="button"
                  disabled={busy || runtimeState.screenShareState === 'inactive'}
                  onClick={() => void stopScreenSharing()}
                >
                  Stop Sharing
                </button>
              </>
            )}
            <button type="button" disabled={busy} onClick={() => void resetSession()}>
              Reset Session
            </button>
          </div>

          <details>
            <summary>Developer diagnostics / controls</summary>
            <div className="peer-actions">
              <button
                type="button"
                disabled={busy || runtimeState.hubStatus !== 'connected'}
                onClick={() => runtimeRef.current?.restartPeerForDiagnostics()}
              >
                Restart Peer Runtime
              </button>
              {runtimeState.hubStatus === 'connected' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runtimeRef.current?.disconnectHubForDiagnostics()}
                >
                  Disconnect Hub
                </button>
              )}
              {runtimeState.hubStatus === 'disconnected' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runtimeRef.current?.reconnectHubForDiagnostics()}
                >
                  Reconnect Hub
                </button>
              )}
            </div>
          </details>
        </section>
      )}
    </main>
  )
}

export function GuestRemoteVideo({
  active,
  stream,
}: {
  active: boolean
  stream: MediaStream | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playbackRequired, setPlaybackRequired] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (video === null) {
      return
    }

    video.srcObject = stream
    if (stream !== null) {
      video.muted = true
      void video.play().then(
        () => setPlaybackRequired(false),
        () => setPlaybackRequired(true),
      )
    }

    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null
      }
    }
  }, [stream])

  return (
    <div className="peer-remote-video">
      <video
        ref={videoRef}
        aria-label="Host shared display"
        autoPlay
        playsInline
        muted
        controls
        hidden={!active || stream === null}
      />
      {!active && <p>Host is not sharing.</p>}
      {active && stream === null && <p>Waiting for the Host video track.</p>}
      {active && stream !== null && playbackRequired && (
        <p>Playback needs a user action. Use the video controls to play.</p>
      )}
    </div>
  )
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function presenceState(
  presence: RoomPresenceParticipant[],
  role: RoomPresenceParticipant['role'],
): 'online' | 'offline' {
  return presence.some((participant) => participant.role === role && participant.connected)
    ? 'online'
    : 'offline'
}

function runtimeStatusMessage(
  status: RoomRuntimeSnapshot['runtimeStatus'],
  role: RoomSession['role'] | undefined,
): string {
  switch (status) {
    case 'waiting-for-counterpart':
      return role === 'Host' ? 'Waiting for Guest.' : 'Waiting for Host.'
    case 'negotiating':
      return 'Connecting peer...'
    case 'connected':
      return 'Peer connected.'
    case 'recovering':
      return 'Reconnecting peer...'
    case 'unavailable':
      return 'Peer connection is currently unavailable.'
  }
}

function formatIcePath(selectedPath: SelectedIcePath | null): string {
  if (selectedPath === null) {
    return '—'
  }

  return `${selectedPath.localCandidateType ?? '—'} → ${selectedPath.remoteCandidateType ?? '—'}`
}

function formatTransport(selectedPath: SelectedIcePath | null): string {
  const protocol = selectedPath?.relayProtocol ?? selectedPath?.transportProtocol ?? null
  return protocol === null ? '—' : protocol.toUpperCase()
}

function formatBitrate(kbps: number | null): string {
  if (kbps === null) {
    return '—'
  }

  return kbps >= 1_000 ? `${(kbps / 1_000).toFixed(1)} Mbps` : `${Math.round(kbps)} Kbps`
}

function formatMilliseconds(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)} ms`
}

function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${percent.toFixed(1)}%`
}

function formatFps(fps: number | null): string {
  return fps === null ? '—' : `${Math.round(fps)}`
}

function formatCount(value: number | null): string {
  return value === null ? '—' : `${value}`
}
