import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar/Navbar'
import Avatar from '../../components/Avatar/Avatar'
import { recentSessions } from '../../mock/socialData'
import { createRoomSession, joinRoomSession } from '../../features/peer/roomApi'
import { browserParticipantCredentialStorage } from '../../features/peer/participantCredentialStorage'
import type { RoomSession } from '../../features/peer/contracts'
import styles from './Dashboard.module.css'

// Real integration: creating/joining a room calls the existing roomApi and
// stores the participant credential exactly as participantCredentialStorage
// expects, unchanged from the working implementation. Visual layer ported
// from the Claude Design raw .dc.html source.
export default function Dashboard() {
  const navigate = useNavigate()
  const [joinId, setJoinId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function goToLobby(action: () => Promise<RoomSession>) {
    setBusy(true)
    setError(null)
    try {
      const session = await action()
      browserParticipantCredentialStorage.write(session.roomId, session.credential)
      navigate(`/lobby/${session.roomId}`, { state: { session } })
    } catch {
      setError('İşlem tamamlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <Navbar active="home" />
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroBg} style={{ backgroundImage: 'url(/assets/dashboard-hero.png)' }} />
          <div className={styles.heroOverlay} />
          <div className={styles.heroContent}>
            <h1>Tekrar hoş geldin,<br /><span className={styles.accent}>Erdem.</span></h1>
            <p className={`${styles.muted} ${styles.heroLead}`}>Bugün birlikte ne yapıyoruz?</p>
            <div className={styles.statPill}>
              <div className={styles.stat}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3ecf6e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                <div>
                  <div className={styles.statNum}>899</div>
                  <div className={`${styles.muted} ${styles.statLabel}`}>Kişi</div>
                </div>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 8.5a5 5 0 0 0 0 7" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><circle cx="12" cy="12" r="1.5" fill="var(--color-accent)" /></svg>
                <div>
                  <div className={styles.statNum}>192</div>
                  <div className={`${styles.muted} ${styles.statLabel}`}>Oda</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.actionGrid}>
          <div className={`${styles.actionCard} ${styles.actionCardAccent}`}>
            <svg width="130" height="130" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} className={styles.actionIconGhost}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <div className={styles.actionHead}>
              <div className={styles.actionIcon}>
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" /></svg>
              </div>
              <div className={styles.actionTitle}>Bir İzleme Odası Oluştur</div>
            </div>
            <p className={`${styles.muted} ${styles.actionDesc}`}>Tek tıkla yeni bir izleme partisi başlat.</p>
            <div className={styles.spacer} />
            <div className={styles.actionFooter}>
              <span className={`${styles.muted} ${styles.tag}`}>GECE SİNEMASI · PATLAMIŞ MISIR VAKTİ</span>
              <button type="button" className={styles.createBtn} disabled={busy} onClick={() => goToLobby(createRoomSession)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Oluştur
              </button>
            </div>
          </div>

          <div className={styles.actionCard}>
            <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className={styles.actionIconGhost2}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            <div className={styles.actionHead}>
              <div className={styles.actionIconAlt}>
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </div>
              <div className={styles.actionTitle}>Bir Odaya Katıl</div>
            </div>
            <p className={`${styles.muted} ${styles.actionDesc}`}>Oda ID'n varsa hemen gir, anında katıl.</p>
            <div className={styles.spacer} />
            <form className={styles.joinRow} onSubmit={(e) => { e.preventDefault(); if (joinId.trim()) goToLobby(() => joinRoomSession(joinId.trim())) }}>
              <input className={styles.joinInput} value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="# ODA KODU" />
              <button type="submit" className={styles.joinBtn} disabled={busy}>
                Katıl
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>
            </form>
          </div>
        </section>
        {error && <p className={styles.errorText}>{error}</p>}

        <section>
          <h3 className={styles.sectionTitle}>Best Duo</h3>
          <div className={styles.duoCard}>
            <div className={styles.duoAvatars}>
              <Avatar initial="E" color="linear-gradient(135deg,var(--color-accent-700),var(--color-accent))" size={88} fontSize={30} />
              <div style={{ marginLeft: -26 }}><Avatar initial="A" color="#c0392b" size={88} fontSize={30} /></div>
            </div>
            <div className={styles.duoInfo}>
              <div className={styles.duoName}>Erdem &amp; Alex</div>
              <div className={styles.muted}>22 Ağustos 2026'dan beri birlikte</div>
              <div className={styles.muted}>🔥 12 gün streak</div>
            </div>
            <div className={styles.vDivider} />
            <div className={styles.duoStats}>
              <div className={styles.duoStatItem}><div className={styles.duoStatNum}>42</div><div className={`${styles.muted} ${styles.duoStatLabel}`}>saat birlikte izlendi</div></div>
              <div className={styles.duoStatItem}><div className={styles.duoStatNum}>18</div><div className={`${styles.muted} ${styles.duoStatLabel}`}>ortak oturum</div></div>
              <div className={styles.duoStatItem}><div className={styles.duoStatNum}>236</div><div className={`${styles.muted} ${styles.duoStatLabel}`}>mesaj gönderildi</div></div>
            </div>
            <div className={styles.vDivider} />
            <div className={styles.duoLevel}>
              <div className={`${styles.muted} ${styles.duoLevelLabel2}`}>DUO SEVİYESİ</div>
              <div className={styles.duoLevelLabel}>Seviye 4 · Sinefil</div>
              <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: '68%' }} /></div>
            </div>
            <div className={styles.duoActions}>
              <Link to="/messages" className={styles.duoActionLight}>Mesaj Gönder</Link>
              <button type="button" className={`btn btn-primary ${styles.duoActionPrimary}`} disabled={busy} onClick={() => goToLobby(createRoomSession)}>Birlikte İzle</button>
            </div>
          </div>
        </section>

        <section>
          <h3 className={styles.sectionTitle}>Son Aktiviteler</h3>
          <div className={styles.activityList}>
            {recentSessions.map((r) => (
              <div key={r.name + r.title} className={styles.activityRow}>
                <Avatar initial={r.initial} color={r.color} size={36} />
                <span className={styles.activityText}>{r.name} ile {r.title} izledin</span>
                <span className={`${styles.muted} ${styles.activityTime}`}>{r.time}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={styles.sectionTitle}>Arkadaşlarınla ne yapmak istersin?</h3>
          <div className={styles.quickGrid}>
            <button type="button" className={styles.quickCard} disabled={busy} onClick={() => goToLobby(createRoomSession)}>
              <div className={styles.quickIcon} style={{ background: 'color-mix(in srgb,var(--color-accent) 18%,transparent)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
              </div>
              <div>
                <div className={styles.quickTitle}>Birlikte İzle</div>
                <p className="card-body" style={{ fontSize: 13, margin: 0 }}>İçerikleri senkronize şekilde izleyin.</p>
              </div>
            </button>
            <div className={styles.quickCard} aria-disabled="true">
              <div className={styles.quickIcon} style={{ background: 'color-mix(in srgb,#8b5cf6 18%,transparent)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="12" x2="10" y2="12" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="15" y1="13" x2="15.01" y2="13" /><line x1="18" y1="11" x2="18.01" y2="11" /><rect x="2" y="6" width="20" height="12" rx="4" /></svg>
              </div>
              <div>
                <div className={styles.quickTitle}>Birlikte Oyna<span className={styles.soon}>Yakında</span></div>
                <p className="card-body" style={{ fontSize: 13, margin: 0 }}>Oyun oynayın, rekabet edin ya da eğlenin.</p>
              </div>
            </div>
            <Link to="/messages" className={styles.quickCard}>
              <div className={styles.quickIcon} style={{ background: 'color-mix(in srgb,#f59e0b 18%,transparent)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              </div>
              <div>
                <div className={styles.quickTitle}>Sohbet Et</div>
                <p className="card-body" style={{ fontSize: 13, margin: 0 }}>Sesli veya yazılı sohbetle bağlantıda kalın.</p>
              </div>
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
