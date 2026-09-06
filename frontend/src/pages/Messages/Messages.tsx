import { useEffect, useRef, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import Avatar from '../../components/Avatar/Avatar'
import { conversations, conversationMessages, type ChatMsg } from '../../mock/socialData'
import styles from './Messages.module.css'

function streakIcon(streak?: number) {
  if (!streak) return null
  if (streak >= 10) return '/assets/streak-10.png'
  if (streak >= 5) return '/assets/streak-5.png'
  return '/assets/streak-1.png'
}

// Mock content — no messaging backend yet (see docs/PRODUCT.md).
// Ported directly from the Claude Design raw .dc.html source.
export default function Messages() {
  const [selectedId, setSelectedId] = useState(0)
  const [messagesById, setMessagesById] = useState(conversationMessages)
  const [draft, setDraft] = useState('')
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = conversations.find((c) => c.id === selectedId) ?? conversations[0]
  const activeMessages = messagesById[selectedId] ?? []
  const lastMineIdx = activeMessages.map((m) => m.from).lastIndexOf('me')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [activeMessages.length, selectedId])

  function send() {
    const text = draft.trim()
    if (!text) return
    setMessagesById((m) => ({ ...m, [selectedId]: [...(m[selectedId] ?? []), { from: 'me', text, read: false } as ChatMsg] }))
    setDraft('')
  }
  function sendInvite() {
    setMessagesById((m) => ({ ...m, [selectedId]: [...(m[selectedId] ?? []), { from: 'me', type: 'invite' } as ChatMsg] }))
  }

  return (
    <div className={styles.page}>
      <Navbar active="messages" />
      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${mobileView === 'chat' ? styles.hiddenMobile : ''}`}>
          <h2 className={styles.sidebarTitle}>Mesajlar</h2>
          <div className={styles.convoList}>
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`${styles.convoRow} ${c.id === selectedId ? styles.convoRowActive : ''}`}
                onClick={() => { setSelectedId(c.id); setMobileView('chat') }}
              >
                <Avatar initial={c.initial} color={c.color} size={44} statusColor={c.dotColor} />
                <div className={styles.convoText}>
                  <div className={styles.convoTop}>
                    <span className={styles.convoName}>
                      {c.name}
                      {c.isBot && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--color-accent)" stroke="none" className={styles.botIcon}><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" /></svg>
                      )}
                      {!!c.streak && <span className={styles.streak}><img src={streakIcon(c.streak)!} alt="" />{c.streak}</span>}
                    </span>
                    <span className={styles.muted}>{c.time}</span>
                  </div>
                  <div className={styles.convoPreview}>{c.lastMessage}</div>
                </div>
                {c.unread && <span className={styles.unreadDot} />}
              </div>
            ))}
          </div>
        </aside>

        <section className={`${styles.chatCol} ${mobileView === 'list' ? styles.hiddenMobile : ''}`}>
          <div className={styles.chatHeader}>
            <button className={styles.backBtn} onClick={() => setMobileView('list')} aria-label="Geri">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <Avatar initial={active.initial} color={active.color} size={38} />
            <div>
              <div className={styles.convoName}>
                {active.name}
                {!!active.streak && <span className={styles.streak}><img src={streakIcon(active.streak)!} alt="" />{active.streak}</span>}
              </div>
              <div className={styles.muted}>{active.online ? 'Çevrimiçi' : (active.lastSeen ?? 'Çevrimdışı')}</div>
            </div>
          </div>
          <div className={styles.scrollArea} ref={scrollRef}>
            {activeMessages.map((m, i) => (
              <div key={i} className={m.from === 'me' ? styles.rowMine : styles.rowTheirs}>
                {m.type === 'invite' ? (
                  <div className={styles.inviteCard}>
                    <div className={styles.inviteHead}>
                      <div className={styles.inviteIcon}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
                      </div>
                      <div className={styles.inviteText}>Birlikte izlemeye davet etti</div>
                    </div>
                    <a href="#" className={`btn btn-primary ${styles.inviteBtn}`} onClick={(e) => e.preventDefault()}>Katıl</a>
                  </div>
                ) : (
                  <div className={m.from === 'me' ? styles.bubbleMine : styles.bubbleTheirs}>{m.text}</div>
                )}
                {m.from === 'me' && i === lastMineIdx && m.type !== 'invite' && (
                  <span className={styles.receipt}>{m.read ? 'Okundu' : 'İletildi'}</span>
                )}
              </div>
            ))}
          </div>
          <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); send() }}>
            <button type="button" className={styles.attachBtn} onClick={sendInvite} aria-label="Davet gönder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Bir mesaj yaz" className={styles.composerInput} />
            <button type="submit" className={styles.sendBtn} aria-label="Gönder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
