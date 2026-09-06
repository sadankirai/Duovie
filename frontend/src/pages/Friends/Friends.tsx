import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar/Navbar'
import Avatar from '../../components/Avatar/Avatar'
import { friends, pendingMutuals, discoverableUsers } from '../../mock/socialData'
import styles from './Friends.module.css'

// Mock content — no social/friends backend yet (see docs/PRODUCT.md).
// Ported directly from the Claude Design raw .dc.html source.
export default function Friends() {
  const [query, setQuery] = useState('')
  const [invitedIds, setInvitedIds] = useState<number[]>([])
  const [requestedIds, setRequestedIds] = useState<number[]>([])
  const [codeCopied, setCodeCopied] = useState(false)

  const q = query.trim().toLowerCase()
  const results = q ? discoverableUsers.filter((u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q)) : []

  return (
    <div className={styles.page}>
      <Navbar active="friends" />
      <main className={styles.main}>
        <div>
          <h1>Arkadaşlar</h1>
          <p className={styles.muted}>Karşılıklı takipleştiğin {friends.length} kişi</p>
        </div>

        <div className={styles.searchWrap}>
          <div className={styles.searchInputWrap}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={styles.searchIcon}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kullanıcı adı veya arkadaşlık koduyla ara" className={styles.searchInput} />
            {results.length > 0 && (
              <div className={styles.searchResults}>
                {results.map((u) => (
                  <div key={u.id} className={styles.searchRow}>
                    <Avatar initial={u.initial} color={u.color} size={34} />
                    <span className={styles.searchName}>{u.name}</span>
                    {requestedIds.includes(u.id)
                      ? <span className={styles.searchMuted}>İstek gönderildi</span>
                      : <a href="#" className={styles.searchFollow} onClick={(e) => { e.preventDefault(); setRequestedIds((ids) => [...ids, u.id]) }}>Takip Et</a>}
                  </div>
                ))}
              </div>
            )}
            {q && results.length === 0 && (
              <div className={styles.searchResults}>
                <p className={styles.searchMuted} style={{ padding: '14px 16px', margin: 0 }}>Kullanıcı bulunamadı.</p>
              </div>
            )}
          </div>
          <div className={styles.codeRow}>
            Kodun: <a href="#" className={styles.codeLink} onClick={(e) => { e.preventDefault(); navigator.clipboard?.writeText('DUOVIE-ERD29X'); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1500) }}>
              {codeCopied ? 'DUOVIE-ERD29X kopyalandı' : 'DUOVIE-ERD29X'}
            </a>
          </div>
        </div>

        <div className={styles.grid}>
          {friends.map((f) => (
            <div key={f.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Avatar initial={f.initial} color={f.color} size={52} statusColor={f.dotColor} />
                <div>
                  <div className={styles.name}>{f.name}</div>
                  <div className={styles.cardMuted}>{f.status}</div>
                </div>
              </div>
              <div className={styles.cardMuted}>{f.hoursWatched} saat birlikte izlediniz</div>
              <div className={styles.cardActions}>
                {invitedIds.includes(f.id)
                  ? (
                    <span className={styles.invitedTag}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      Davet edildi
                    </span>
                  )
                  : <a href="#" className={`btn btn-primary ${styles.inviteBtn}`} onClick={(e) => { e.preventDefault(); setInvitedIds((ids) => [...ids, f.id]) }}>Birlikte İzle</a>}
                <Link to="/messages" className={styles.msgBtn} aria-label="Mesaj gönder">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className={styles.hr} />
          <h3>Yakında arkadaş olabilirsiniz</h3>
          <p className={styles.mutualDesc}>Bu kişileri takip ediyorsun — seni de takip ederlerse arkadaş listene eklenir.</p>
          <div className={styles.mutualList}>
            {pendingMutuals.map((p) => (
              <div key={p.name} className={styles.mutualRow}>
                <Avatar initial={p.initial} color={p.color} size={40} />
                <div className={styles.mutualInfo}>
                  <div className={styles.mutualName}>{p.name}</div>
                  <div className={styles.mutualSub}>Sen takip ediyorsun</div>
                </div>
                <span className={styles.pillOutline}>Takip etmiyor</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
