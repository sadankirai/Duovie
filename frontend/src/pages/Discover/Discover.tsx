import { useRef, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import Avatar from '../../components/Avatar/Avatar'
import { discoverRooms, suggestedPeople } from '../../mock/socialData'
import styles from './Discover.module.css'

const filterDefs = [
  { id: 'all', label: 'Tümü' },
  { id: 'rooms', label: 'Odalar' },
  { id: 'people', label: 'Kişiler' },
  { id: 'activities', label: 'Aktiviteler' },
]

// Mock content (no social/discovery backend yet, see docs/PRODUCT.md).
// Ported directly from the Claude Design raw .dc.html source.
export default function Discover() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [joinedIds, setJoinedIds] = useState<number[]>([])
  const [requestedIds, setRequestedIds] = useState<number[]>([])
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const rooms = discoverRooms.filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.host.toLowerCase().includes(q))
  const people = suggestedPeople.filter((p) => !q || p.name.toLowerCase().includes(q))

  const scrollBy = (dir: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.85, 640), behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtStart(el.scrollLeft <= 4)
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4)
  }

  return (
    <div className={styles.page}>
      <Navbar active="discover" />
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroImgWrap}>
            <div className={styles.heroBg} style={{ backgroundImage: 'url(/assets/discover-hero-cinema.png)' }} />
            <div className={styles.heroOverlay} />
            <div className={styles.heroTextWrap}>
              <div className={styles.kicker}>KEŞFET</div>
              <h1>Yeni odalar,<br />yeni insanlar.</h1>
            </div>
          </div>
          <div className={styles.heroBody}>
            <p className={styles.heroDesc}>Duovie'de senin gibi film tutkunlarıyla tanış, açık odalara katıl ve birlikte izlemenin keyfini çıkar.</p>
            <div className={styles.controlsRow}>
              <div className={styles.searchWrap}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={styles.searchIcon}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Oda, kişi veya etkinlik ara..." className={styles.searchInput} />
              </div>
              <div className={styles.filters}>
                {filterDefs.map((f) => (
                  <span key={f.id} className={`${styles.filterPill} ${filter === f.id ? styles.filterActive : ''}`} onClick={() => setFilter(f.id)}>{f.label}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="rooms-section">
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <span className={styles.sectionBar} />
              <div>
                <h3>Şu Anda Aktif Odalar</h3>
                <p className={styles.muted}>Keşfedilebilir açık odalara katıl, yeni insanlarla tanış.</p>
              </div>
            </div>
            <a href="#" className={styles.seeAll}>Tüm Odaları Gör
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </a>
          </div>
          <div className={styles.roomsWrap}>
            <div ref={scrollRef} onScroll={onScroll} className={`no-scrollbar ${styles.roomsScroll}`}>
              {rooms.map((r) => {
                const occupied = joinedIds.includes(r.id) ? Math.min(r.occupied + 1, 2) : r.occupied
                const isFull = occupied >= 2
                const isWatch = r.activityLabel === 'Birlikte İzle'
                const isPlay = r.activityLabel === 'Birlikte Oyna'
                return (
                  <div key={r.id} className={styles.roomCard} style={{ background: `linear-gradient(155deg,var(--color-surface) 0%,color-mix(in srgb,${r.hostColor} 22%,var(--color-surface)) 100%)` }}>
                    {isWatch && <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', right: -22, bottom: 38, opacity: 0.12, pointerEvents: 'none' }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M17 7.5h4M3 12h18M3 16.5h4M17 16.5h4" /></svg>}
                    {isPlay && <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', right: -22, bottom: 38, opacity: 0.12, pointerEvents: 'none' }}><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="6" y1="12" x2="10" y2="12" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="15" y1="13" x2="15.01" y2="13" /><line x1="18" y1="11" x2="18.01" y2="11" /></svg>}
                    {!isWatch && !isPlay && <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', right: -22, bottom: 38, opacity: 0.12, pointerEvents: 'none' }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>}
                    <div className={styles.roomTop}>
                      <span className={styles.openTag}><span className={styles.openDot} />Açık</span>
                      <span className={styles.occupancyTag}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        {occupied}/2
                      </span>
                    </div>
                    <div className={styles.hostRow}>
                      <div className={styles.hostAvatars}>
                        <Avatar initial={r.hostInitial} color={r.hostColor} size={72} fontSize={26} />
                        <div style={{ marginLeft: -20 }}>
                          {isFull
                            ? <Avatar initial="+1" color="var(--color-accent)" size={78} fontSize={22} />
                            : <Avatar initial="" color="color-mix(in srgb,#fff 10%,transparent)" size={78} />}
                        </div>
                      </div>
                      <span className={styles.hostName}>{r.host}</span>
                    </div>
                    <div className={styles.roomBottom}>
                      <div>
                        <div className={styles.roomName}>{r.name}</div>
                        <div className={styles.tagRow}>
                          <span className={styles.actLabel}>{r.activityLabel}</span>
                          <span className={styles.catLabel}>{r.category}</span>
                        </div>
                      </div>
                      {isFull
                        ? <span className={styles.fullTag}>Dolu</span>
                        : <a href="#" className={`btn btn-primary ${styles.joinBtn}`} onClick={(e) => { e.preventDefault(); setJoinedIds((ids) => [...ids, r.id]) }}>İstek Gönder</a>}
                    </div>
                  </div>
                )
              })}
              {rooms.length === 0 && <p className={styles.muted}>Aramanla eşleşen oda bulunamadı.</p>}
            </div>
            {!atStart && (
              <span className={`${styles.carouselArrow} ${styles.arrowLeft}`} onClick={() => scrollBy(-1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </span>
            )}
            {!atEnd && (
              <span className={`${styles.carouselArrow} ${styles.arrowRight}`} onClick={() => scrollBy(1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </span>
            )}
          </div>
        </section>

        <section id="people-section">
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" /></svg>
              <h3>Önerilen Kişiler</h3>
            </div>
            <a href="#" className={styles.seeAll}>Tümünü Gör
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </a>
          </div>
          <p className={styles.muted} style={{ marginBottom: 16 }}>Ortak arkadaşlarına ve ilgi alanlarına göre.</p>
          <div className={styles.peopleGrid}>
            {people.map((p) => (
              <div key={p.id} className={styles.personRow}>
                <Avatar initial={p.initial} color={p.color} size={46} />
                <div className={styles.personInfo}>
                  <div className={styles.personName}>{p.name}</div>
                  <div className={styles.personSub}>@{p.handle} · {p.reason}</div>
                </div>
                {requestedIds.includes(p.id)
                  ? (
                    <span className={styles.requestedTag}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      İstek gönderildi
                    </span>
                  )
                  : <a href="#" className={`btn btn-primary ${styles.followBtn}`} onClick={(e) => { e.preventDefault(); setRequestedIds((ids) => [...ids, p.id]) }}>Takip Et</a>}
              </div>
            ))}
          </div>
        </section>

        <p className={styles.quote}>"İyi bir film, iyi bir arkadaşla daha güzel."</p>
      </main>
    </div>
  )
}
