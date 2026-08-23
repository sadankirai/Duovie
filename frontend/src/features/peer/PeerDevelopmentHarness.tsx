import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  initialPeerConnectionStatus,
  type PeerConnectionStatus,
  type RoomPresenceParticipant,
  type RoomSession,
} from './contracts'
import { RoomHubClient, type RoomHubHandlers } from './RoomHubClient'
import { createRoomSession, joinRoomSession } from './roomApi'
import {
  isWebRtcPeerConnectionSupported,
  WebRtcPeerController,
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const hubClientRef = useRef<RoomHubClient | null>(null)
  const peerControllerRef = useRef<WebRtcPeerController | null>(null)
  const webRtcSupported = isWebRtcPeerConnectionSupported()

  const disposeRuntime = useCallback(async () => {
    const peerController = peerControllerRef.current
    const hubClient = hubClientRef.current

    peerControllerRef.current = null
    hubClientRef.current = null
    peerController?.close()

    if (hubClient !== null) {
      await hubClient.stop()
    }
  }, [])

  const applyPeerSignal = useCallback((operation: (peer: WebRtcPeerController) => Promise<void>) => {
    const peerController = peerControllerRef.current
    if (peerController === null) {
      setMessage('This browser cannot process the peer signal.')
      return
    }

    void operation(peerController).catch(() => {
      peerController.close()
      setMessage('The peer signal could not be applied.')
    })
  }, [])

  const connectSession = useCallback(
    async (roomSession: RoomSession) => {
      setSession(roomSession)
      setPresence([])
      setPeerStatus(initialPeerConnectionStatus)
      setHubStatus('connecting')

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
        onDisconnected: () => {
          peerControllerRef.current?.close()
          peerControllerRef.current = null
          setHubStatus('disconnected')
          setPresence([])
          setMessage('The Room Hub disconnected. Reset the harness to reconnect.')
        },
      }

      const hubClient = new RoomHubClient(roomSession, handlers)
      hubClientRef.current = hubClient

      if (webRtcSupported) {
        peerControllerRef.current = new WebRtcPeerController(roomSession.role, hubClient, {
          onStatusChanged: (status) => {
            setPeerStatus(status)
            setHostSenderTrackState(
              peerControllerRef.current?.hostSenderTrackState ?? 'not-created',
            )
          },
          onSignalSendFailed: () => {
            setMessage('A peer signal could not be sent because the Room Hub is unavailable.')
          },
        })
      }

      await hubClient.start()
      setHubStatus('connected')
    },
    [applyPeerSignal, webRtcSupported],
  )

  const resetHarness = useCallback(async () => {
    setBusy(true)

    try {
      await disposeRuntime()
    } finally {
      setSession(null)
      setPresence([])
      setHubStatus('disconnected')
      setPeerStatus(initialPeerConnectionStatus)
      setHostSenderTrackState('not-created')
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
    } catch {
      setMessage('The Host could not start peer negotiation.')
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
        <p>Stage 4.1 transport handshake only. No media is captured or sent.</p>
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
                {session.role === 'Host' && (
                  <StateRow label="Video sender track" value={hostSenderTrackState} />
                )}
              </dl>
            </section>
          </div>

          <div className="peer-actions">
            {session.role === 'Host' && (
              <button
                type="button"
                disabled={busy || hubStatus !== 'connected' || !guestIsPresent || !webRtcSupported}
                onClick={() => void startPeerConnection()}
              >
                Start P2P
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void resetHarness()}>
              Reset
            </button>
          </div>
        </section>
      )}
    </main>
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
