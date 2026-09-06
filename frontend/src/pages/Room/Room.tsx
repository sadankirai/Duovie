import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRoomSession } from '../../features/room/session'
import { useRoomRuntime } from '../../features/room/useRoomRuntime'
import styles from './Room.module.css'

const statusLabels: Record<string, string> = {
  'waiting-for-counterpart': 'Karşı taraf bekleniyor',
  negotiating: 'Bağlanıyor…',
  connected: 'İyi bağlantı',
  recovering: 'Yeniden bağlanıyor…',
  unavailable: 'Bağlantı yok',
}
const statusColors: Record<string, string> = {
  'waiting-for-counterpart': '#e0a83e',
  negotiating: '#e0a83e',
  connected: '#3ecf6e',
  recovering: '#e0a83e',
  unavailable: '#c0392b',
}

// Real integration: useRoomRuntime wraps the existing RoomRuntime/RoomHubClient/
// WebRtcPeerController stack untouched — this component only changed the
// visual layer (ported from the Claude Design raw .dc.html source) around it.
// Chat below stays NOT wired to any hub — contracts.ts / RoomHubClient have no
// chat method or event yet, so messages remain local-only until that's added
// server-side; the fancier reactions/reply/resize chat UI from the source
// mockup was skipped since it has nothing real to attach to yet.
export default function Room() {
  const { session, roomId, error } = useRoomSession()
  const { snapshot, remoteStream, notice, startScreenShare, stopScreenShare } = useRoomRuntime(session)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [sharePopupOpen, setSharePopupOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Kopyala')
  const [draft, setDraft] = useState('')
  const [localMessages, setLocalMessages] = useState<{ from: string; text: string; color: string }[]>([])
  const isHost = session?.role === 'Host'
  const participantCount = snapshot.presence.length || (session ? 1 : 0)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = remoteStream
  }, [remoteStream])

  function copyCode() {
    if (roomId) navigator.clipboard?.writeText(roomId)
    setCopyLabel('Kopyalandı')
    setTimeout(() => setCopyLabel('Kopyala'), 1500)
  }

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.roomNameWrap}>
          <span className={styles.roomName}>Oda</span>
          <span className={styles.pill}>{roomId?.slice(0, 8)}</span>
        </div>
        <div className={styles.status}>
          <span className={styles.statusDot} style={{ background: statusColors[snapshot.runtimeStatus] ?? '#6b6b6b' }} />
          {statusLabels[snapshot.runtimeStatus] ?? snapshot.runtimeStatus}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className={styles.inviteBtn} onClick={() => setInviteOpen((v) => !v)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            Davet Et
          </button>
          {inviteOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setInviteOpen(false)} />
              <div style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 'min(260px,calc(100vw - 24px))', background: '#1c1a19', border: '1px solid var(--color-divider)', borderRadius: 10, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', zIndex: 61, padding: 14 }}>
                <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>Oda Kodu</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomId}</span>
                </div>
                <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: 10, fontSize: 13 }} onClick={copyCode}>{copyLabel}</button>
              </div>
            </>
          )}
        </div>
        <Link to="/dashboard" className={styles.leaveBtn}>Odadan Ayrıl</Link>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      {notice && <p className={styles.noticeText}>{notice}</p>}
      <div className={styles.body}>
        <div className={styles.videoArea}>
          <video ref={videoRef} autoPlay playsInline className={styles.video} />
          {!remoteStream && <div className={styles.videoPlaceholder}>Henüz paylaşım başlamadı</div>}

          {isHost && sharePopupOpen && (
            <div className={styles.sharePopup}>
              <p className={styles.muted}>Ekranını arkadaşınla paylaşmaya başla.</p>
              <button
                type="button"
                className={styles.startShareBtn}
                onClick={async () => {
                  setSharePopupOpen(false)
                  try {
                    await startScreenShare()
                  } catch {
                    // WebRtcPeerController already surfaces failures via onNotice.
                  }
                }}
              >
                Paylaşımı Başlat
              </button>
            </div>
          )}
          {isHost && !sharePopupOpen && snapshot.screenShareState === 'active' && (
            <button type="button" className={styles.stopShareBtn} onClick={() => stopScreenShare()}>Paylaşımı Durdur</button>
          )}
        </div>

        {chatOpen && (
          <div className={styles.chatPanel}>
            <div className={styles.chatHeader}>
              <div>
                <div className={styles.chatHeaderTitle}>Sohbet</div>
                <div className={styles.chatHeaderSub}>{participantCount}/2 katılımcı</div>
              </div>
              <button type="button" className={styles.chatClose} onClick={() => setChatOpen(false)} aria-label="Kapat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className={styles.chatScroll}>
              {localMessages.map((m, i) => (
                <div key={i} className={styles.msgRow}>
                  <div className={styles.msgAvatar} style={{ background: m.color }}>{m.from[0]}</div>
                  <div>
                    <div className={styles.msgFrom}>{m.from}</div>
                    <div className={styles.msgBubble}>{m.text}</div>
                  </div>
                </div>
              ))}
              {localMessages.length === 0 && <p className={styles.muted}>Sohbet backend'e henüz bağlı değil — mesajlar şu an yalnızca sende görünür.</p>}
            </div>
            <form
              className={styles.composer}
              onSubmit={(e) => {
                e.preventDefault()
                if (draft.trim()) {
                  setLocalMessages((m) => [...m, { from: 'Sen', text: draft.trim(), color: 'linear-gradient(135deg,var(--color-accent-700),var(--color-accent))' }])
                  setDraft('')
                }
              }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Bir mesaj yaz" className={styles.composerInput} />
              <button type="submit" className={styles.sendBtn} aria-label="Gönder">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
