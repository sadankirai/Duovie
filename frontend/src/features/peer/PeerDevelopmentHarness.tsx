import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  initialPeerConnectionStatus,
  type PeerConnectionStatus,
  type RoomPresenceParticipant,
  type RoomScreenShareStateChanged,
  type RoomSession,
} from './contracts'
import { RoomHubClient, type RoomHubHandlers } from './RoomHubClient'
import { createRoomSession, joinRoomSession } from './roomApi'
import {
  isWebRtcPeerConnectionSupported,
  WebRtcPeerController,
  type RemoteVideoState,
  type ScreenShareState,
} from './WebRtcPeerController'

type HubStatus = 'disconnected' | 'connecting' | 'connected'

export function PeerDevelopmentHarness() {
  const [joinRoomId, setJoinRoomId] = useState('')
  const [session, setSession] = useState<RoomSession | null>(null)
  const [presence, setPresence] = useState<RoomPresenceParticipant[]>([])
  const [hubStatus, setHubStatus] = useState<HubStatus>('disconnected')
  const [peerStatus, setPeerStatus] = useState<PeerConnectionStatus>(
    initialPeerConnectionStatus,
  )
  const [hostSenderTrackState, setHostSenderTrackState] = useState<
    'not-created' | 'null' | 'attached'
  >('not-created')
  const [peerActive, setPeerActive] = useState(false)
  const [peerNeedsReset, setPeerNeedsReset] = useState(false)
  const [screenShareState, setScreenShareState] = useState<ScreenShareState>('inactive')
  const [displayCaptureRequestPending, setDisplayCaptureRequestPending] =
    useState(false)
  const [remoteVideoState, setRemoteVideoState] = useState<RemoteVideoState>('unavailable')
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null)
  const [hostScreenShareActive, setHostScreenShareActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const hubClientRef = useRef<RoomHubClient | null>(null)
  const peerControllerRef = useRef<WebRtcPeerController | null>(null)
  const webRtcSupported = isWebRtcPeerConnectionSupported()

  const installPeerController = useCallback(
    (roomSession: RoomSession, hubClient: RoomHubClient) => {
      if (!webRtcSupported) {
        return
      }

      const controller = new WebRtcPeerController(roomSession.role, hubClient, {
        onStatusChanged: (status) => {
          setPeerStatus(status)
          const currentController = peerControllerRef.current
          setPeerActive(currentController?.hasActivePeer ?? false)
          setPeerNeedsReset(currentController?.requiresResetBeforeRetry ?? false)
          setHostSenderTrackState(
            currentController?.hostSenderTrackState ?? 'not-created',
          )
        },
        onSignalSendFailed: () => {
          setPeerActive(false)
          setPeerNeedsReset(true)
          setHostSenderTrackState('not-created')
          setMessage('A peer signal could not be sent. Reset the peer before retrying.')
        },
        onRecoveryNeeded: (reason) => {
          setPeerActive(false)
          setPeerNeedsReset(true)
          setHostSenderTrackState('not-created')
          setMessage(
            reason === 'connection-failed'
              ? 'The peer connection failed. Reset the peer before retrying.'
              : 'The peer connection closed. Reset the peer before retrying.',
          )
        },
        onScreenShareStateChanged: (state) => {
          setScreenShareState(state)
          const currentController = peerControllerRef.current
          setDisplayCaptureRequestPending(
            currentController?.hasPendingDisplayCaptureRequest ?? false,
          )
          setHostSenderTrackState(currentController?.hostSenderTrackState ?? 'not-created')
        },
        onRemoteVideoChanged: (stream, state) => {
          setRemoteVideoStream(stream)
          setRemoteVideoState(state)
        },
        onHostScreenShareChanged: (active) => setHostScreenShareActive(active),
        onMediaOperationFailed: () => {
          setMessage('A browser media operation failed safely. The peer remains available.')
        },
      })

      peerControllerRef.current = controller
      setPeerStatus(initialPeerConnectionStatus)
      setPeerActive(false)
      setPeerNeedsReset(false)
      setHostSenderTrackState('not-created')
      setScreenShareState('inactive')
      setDisplayCaptureRequestPending(false)
      setRemoteVideoStream(null)
      setRemoteVideoState('unavailable')
      setHostScreenShareActive(false)
    },
    [webRtcSupported],
  )

  const disposePeer = useCallback(() => {
    const peerController = peerControllerRef.current
    peerControllerRef.current = null
    peerController?.close()
    setPeerActive(false)
    setPeerNeedsReset(false)
    setHostSenderTrackState('not-created')
    setScreenShareState('inactive')
    setDisplayCaptureRequestPending(false)
    setRemoteVideoStream(null)
    setRemoteVideoState('unavailable')
    setHostScreenShareActive(false)
  }, [])

  const disposeRuntime = useCallback(async () => {
    const hubClient = hubClientRef.current

    disposePeer()
    hubClientRef.current = null

    if (hubClient !== null) {
      await hubClient.stop()
    }
  }, [disposePeer])

  const resetPeerForOfflineParticipant = useCallback(
    (participant: RoomPresenceParticipant, localRole: RoomSession['role']) => {
      if (participant.connected || participant.role === localRole) {
        return
      }

      peerControllerRef.current?.resetPeer(false)
      setPeerActive(false)
      setPeerNeedsReset(false)
      setHostSenderTrackState('not-created')
      setScreenShareState('inactive')
      setMessage(`${participant.role} went offline. The peer was reset and can be retried.`)
    },
    [],
  )

  const applyPeerSignal = useCallback(
    (operation: (peer: WebRtcPeerController) => Promise<void>) => {
      const peerController = peerControllerRef.current
      if (peerController === null) {
        setMessage('This browser cannot process the peer signal.')
        return
      }

      void operation(peerController).catch(() => {
        setPeerActive(peerController.hasActivePeer)
        setPeerNeedsReset(peerController.requiresResetBeforeRetry)
        setHostSenderTrackState(peerController.hostSenderTrackState)
        setMessage(
          peerController.requiresResetBeforeRetry
            ? 'The peer signal failed. Reset the peer before retrying.'
            : 'The peer signal was rejected safely.',
        )
      })
    },
    [],
  )

  const connectSession = useCallback(
    async (roomSession: RoomSession) => {
      setSession(roomSession)
      setPresence([])
      setPeerStatus(initialPeerConnectionStatus)
      setHubStatus('connecting')

      let hubClient: RoomHubClient | null = null
      const handlers: RoomHubHandlers = {
        onPresenceSnapshot: (snapshot) => setPresence(snapshot.participants),
        onPresenceChanged: (participant) => {
          setPresence((current) => {
            const withoutParticipant = current.filter(
              (item) => item.participantId !== participant.participantId,
            )

            return participant.connected
              ? [...withoutParticipant, participant]
              : withoutParticipant
          })
          resetPeerForOfflineParticipant(participant, roomSession.role)
        },
        onWebRtcOffer: (offer) => {
          applyPeerSignal((peer) => peer.handleOffer(offer))
        },
        onWebRtcAnswer: (answer) => {
          applyPeerSignal((peer) => peer.handleAnswer(answer))
        },
        onIceCandidate: (candidate) => {
          applyPeerSignal((peer) => peer.handleRemoteIceCandidate(candidate))
        },
        onScreenShareStateChanged: (state: RoomScreenShareStateChanged) => {
          if (hubClient === null || hubClientRef.current !== hubClient) {
            return
          }

          peerControllerRef.current?.handleScreenShareStateChanged(state)
        },
        onDisconnected: () => {
          disposePeer()
          setHubStatus('disconnected')
          setPresence([])
          setMessage('The Room Hub disconnected. Reconnect it or reset the session.')
        },
      }

      hubClient = new RoomHubClient(roomSession, handlers)
      hubClientRef.current = hubClient
      installPeerController(roomSession, hubClient)

      await hubClient.start()
      setHubStatus('connected')
    },
    [applyPeerSignal, disposePeer, installPeerController, resetPeerForOfflineParticipant],
  )

  const resetSession = useCallback(async () => {
    setBusy(true)

    try {
      await disposeRuntime()
    } finally {
      setSession(null)
      setPresence([])
      setHubStatus('disconnected')
      setPeerStatus(initialPeerConnectionStatus)
      setHostSenderTrackState('not-created')
      setPeerActive(false)
      setPeerNeedsReset(false)
      setScreenShareState('inactive')
      setDisplayCaptureRequestPending(false)
      setRemoteVideoStream(null)
      setRemoteVideoState('unavailable')
      setHostScreenShareActive(false)
      setMessage(null)
      setBusy(false)
    }
  }, [disposeRuntime])

  useEffect(() => {
    return () => {
      peerControllerRef.current?.close()
      peerControllerRef.current = null
      const hubClient = hubClientRef.current
      hubClientRef.current = null

      if (hubClient !== null) {
        void hubClient.stop().catch(() => undefined)
      }
    }
  }, [])

  const createRoom = async () => {
    setBusy(true)
    setMessage(null)

    try {
      await connectSession(await createRoomSession())
    } catch {
      await disposeRuntime()
      setSession(null)
      setHubStatus('disconnected')
      setMessage('The Host session could not be created or connected.')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault()
    const roomId = joinRoomId.trim()

    if (!roomId) {
      setMessage('Enter a Room ID to join.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await connectSession(await joinRoomSession(roomId))
    } catch {
      await disposeRuntime()
      setSession(null)
      setHubStatus('disconnected')
      setMessage('The Guest session could not be created or connected.')
    } finally {
      setBusy(false)
    }
  }

  const startPeerConnection = async () => {
    const peerController = peerControllerRef.current
    if (peerController === null) {
      setMessage('WebRTC peer connections are unavailable in this browser.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await peerController.startHostNegotiation(guestIsPresent)
      setPeerActive(peerController.hasActivePeer)
      setPeerNeedsReset(peerController.requiresResetBeforeRetry)
      setHostSenderTrackState(peerController.hostSenderTrackState)
    } catch {
      setPeerActive(peerController.hasActivePeer)
      setPeerNeedsReset(peerController.requiresResetBeforeRetry)
      setHostSenderTrackState(peerController.hostSenderTrackState)
      setMessage(
        peerController.requiresResetBeforeRetry
          ? 'Peer negotiation failed. Reset the peer before retrying.'
          : 'The Host could not start peer negotiation.',
      )
    } finally {
      setBusy(false)
    }
  }

  const resetPeerConnection = () => {
    const peerController = peerControllerRef.current
    if (peerController === null) {
      return
    }

    peerController.resetPeer()
    setPeerStatus({
      ...initialPeerConnectionStatus,
      connectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
    })
    setPeerActive(false)
    setPeerNeedsReset(false)
    setHostSenderTrackState('not-created')
    setScreenShareState('inactive')
    setMessage('The peer was reset. The Room session and Hub connection were preserved.')
  }

  const shareScreen = async () => {
    const peerController = peerControllerRef.current
    if (peerController === null) {
      setMessage('WebRTC peer connections are unavailable in this browser.')
      return
    }

    setMessage(null)
    setDisplayCaptureRequestPending(true)

    try {
      await peerController.startScreenShare()
      if (peerControllerRef.current !== peerController) {
        return
      }

      setHostSenderTrackState(peerController.hostSenderTrackState)
    } catch {
      if (peerControllerRef.current !== peerController) {
        return
      }

      setScreenShareState(peerController.screenShareState)
      setHostSenderTrackState(peerController.hostSenderTrackState)
      setMessage('Screen sharing did not start. You can try again explicitly.')
    } finally {
      if (peerControllerRef.current === peerController) {
        setDisplayCaptureRequestPending(
          peerController.hasPendingDisplayCaptureRequest,
        )
      }
    }
  }

  const stopScreenSharing = async () => {
    const peerController = peerControllerRef.current
    if (peerController === null) {
      return
    }

    setMessage(null)

    try {
      await peerController.stopScreenShare()
      if (peerControllerRef.current !== peerController) {
        return
      }

      setHostSenderTrackState(peerController.hostSenderTrackState)
    } catch {
      if (peerControllerRef.current !== peerController) {
        return
      }

      setScreenShareState(peerController.screenShareState)
      setHostSenderTrackState(peerController.hostSenderTrackState)
      setMessage('Screen sharing stopped, but browser cleanup reported a safe failure.')
    }
  }

  const disconnectHub = async () => {
    const hubClient = hubClientRef.current
    if (hubClient === null) {
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await hubClient.disconnect()
    } catch {
      setMessage('The Room Hub disconnect request failed.')
    } finally {
      setBusy(false)
    }
  }

  const reconnectHub = async () => {
    const hubClient = hubClientRef.current
    if (hubClient === null || session === null) {
      return
    }

    setBusy(true)
    setMessage(null)
    setHubStatus('connecting')
    installPeerController(session, hubClient)

    try {
      await hubClient.start()
      setHubStatus('connected')
      setMessage('The Room Hub reconnected. Start a fresh peer negotiation when ready.')
    } catch {
      disposePeer()
      setHubStatus('disconnected')
      setMessage('The Room Hub could not reconnect. Retry or reset the session.')
    } finally {
      setBusy(false)
    }
  }

  const copyRoomId = async () => {
    if (session === null) {
      return
    }

    try {
      await navigator.clipboard.writeText(session.roomId)
      setMessage('Room ID copied.')
    } catch {
      setMessage('Copy failed. Select the Room ID manually.')
    }
  }

  const guestIsPresent = presence.some(
    (participant) => participant.role === 'Guest' && participant.connected,
  )

  return (
    <main className="peer-harness">
      <header>
        <h1>Duovie peer development harness</h1>
        <p>Stage 5.1 Host display video over the existing P2P connection. No audio.</p>
      </header>

      {!webRtcSupported && (
        <p role="alert" className="peer-message">
          This browser does not support the standard RTCPeerConnection API.
        </p>
      )}

      {message !== null && (
        <p role="status" className="peer-message">
          {message}
        </p>
      )}

      {session === null ? (
        <section className="peer-entry" aria-label="Room session setup">
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
            <button type="submit" disabled={busy}>
              Join Room
            </button>
          </form>
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
            <button type="button" onClick={() => void copyRoomId()}>
              Copy Room ID
            </button>
          </div>

          <div className="peer-grid">
            <section>
              <h2>Room Hub</h2>
              <dl>
                <StateRow label="Connection" value={hubStatus} />
                <StateRow label="Host presence" value={presenceState(presence, 'Host')} />
                <StateRow label="Guest presence" value={presenceState(presence, 'Guest')} />
              </dl>
            </section>

            <section>
              <h2>WebRTC peer</h2>
              <dl>
                <StateRow label="Connection" value={peerStatus.connectionState} />
                <StateRow label="ICE connection" value={peerStatus.iceConnectionState} />
                <StateRow label="ICE gathering" value={peerStatus.iceGatheringState} />
                <StateRow label="Signaling" value={peerStatus.signalingState} />
                <StateRow label="Retry state" value={peerNeedsReset ? 'reset required' : 'ready'} />
                {session.role === 'Host' && (
                  <>
                    <StateRow label="Video sender track" value={hostSenderTrackState} />
                    <StateRow label="Screen share" value={screenShareState} />
                  </>
                )}
                {session.role === 'Guest' && (
                  <StateRow
                    label="Remote video"
                    value={
                      hostScreenShareActive
                        ? remoteVideoState === 'unavailable'
                          ? 'waiting'
                          : remoteVideoState
                        : 'not sharing'
                    }
                  />
                )}
              </dl>
              {session.role === 'Guest' && (
                <GuestRemoteVideo
                  active={hostScreenShareActive}
                  stream={remoteVideoStream}
                />
              )}
            </section>
          </div>

          <div className="peer-actions">
            {session.role === 'Host' && (
              <>
                <button
                  type="button"
                  disabled={
                    busy ||
                    hubStatus !== 'connected' ||
                    !guestIsPresent ||
                    !webRtcSupported ||
                    peerActive ||
                    peerNeedsReset
                  }
                  onClick={() => void startPeerConnection()}
                >
                  Start P2P
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    hubStatus !== 'connected' ||
                    !webRtcSupported ||
                    !peerActive ||
                    peerNeedsReset ||
                    peerStatus.connectionState !== 'connected' ||
                    peerStatus.signalingState !== 'stable' ||
                    displayCaptureRequestPending ||
                    screenShareState !== 'inactive'
                  }
                  onClick={() => void shareScreen()}
                >
                  Share Screen
                </button>
                <button
                  type="button"
                  disabled={busy || screenShareState === 'inactive'}
                  onClick={() => void stopScreenSharing()}
                >
                  Stop Sharing
                </button>
              </>
            )}
            {hubStatus === 'connected' ? (
              <>
                <button
                  type="button"
                  disabled={busy || !webRtcSupported}
                  onClick={resetPeerConnection}
                >
                  Reset Peer
                </button>
                <button type="button" disabled={busy} onClick={() => void disconnectHub()}>
                  Disconnect Hub
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => void reconnectHub()}>
                Reconnect Hub
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void resetSession()}>
              Reset Session
            </button>
          </div>
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
