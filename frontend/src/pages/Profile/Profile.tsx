import { useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import Avatar from '../../components/Avatar/Avatar'
import Modal from '../../components/Modal/Modal'
import { topFriends } from '../../mock/socialData'
import styles from './Profile.module.css'

// Mock content — no profile/social backend yet (see docs/PRODUCT.md). Avatar
// and banner "edit" affordances are a visual shell (Modal) since there's
// nowhere to persist an upload server-side. Ported from the Claude Design
// raw .dc.html source; desktop and mobile hero layouts both kept (CSS
// media query switches between them, matching the source's isDesktop/isMobile split).
export default function Profile() {
  const [photoModalOpen, setPhotoModalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [listModal, setListModal] = useState<'followers' | 'following' | null>(null)

  const following = topFriends.slice().reverse()

  return (
    <div className={styles.page}>
      <Navbar active="profile" />

      <div className={styles.heroWrap}>
        <div className={styles.bannerZone} onClick={() => setPhotoModalOpen(true)}>
          <div className={styles.bannerEditIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4h9" /><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </div>
        </div>
        <div className={styles.heroContent}>
          <div className={styles.avatarWrap} onClick={() => setPhotoModalOpen(true)}>
            <Avatar initial="E" color="linear-gradient(135deg,var(--color-accent-700),var(--color-accent))" size={240} fontSize={80} />
            <div className={styles.avatarOverlay}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4h9" /><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              <span className={styles.avatarOverlayText}>Fotoğraf seç</span>
            </div>
          </div>
          <div className={styles.identity}>
            <span className={`${styles.muted} ${styles.profileLabel}`}>Profil</span>
            <div className={styles.nameRow}>
              <div className={styles.name}>Erdem</div>
            </div>
            <div className={`${styles.muted} ${styles.metaRow}`}>
              <span>Seviye 12</span>
              <span>·</span>
              <span className={styles.metaLink} onClick={() => setListModal('followers')}><span className={styles.metaStrong}>26</span> Takipçi</span>
              <span>·</span>
              <span className={styles.metaLink} onClick={() => setListModal('following')}>Takip Edilen: <span className={styles.metaStrong}>18</span></span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.mobileHeroWrap}>
        <div className={styles.mobileBanner} onClick={() => setPhotoModalOpen(true)} />
        <div className={styles.mobileIdentity}>
          <div className={styles.mobileAvatar} onClick={() => setPhotoModalOpen(true)}>
            <Avatar initial="E" color="linear-gradient(135deg,var(--color-accent-700),var(--color-accent))" size={96} fontSize={32} />
          </div>
          <div>
            <div className={styles.mobileName}>Erdem</div>
            <div className={`${styles.muted} ${styles.mobileMeta}`}>
              <span>Seviye 12</span>
              <span>·</span>
              <span onClick={() => setListModal('followers')}><span className={styles.metaStrong}>26</span> Takipçi</span>
              <span>·</span>
              <span onClick={() => setListModal('following')}>Takip: <span className={styles.metaStrong}>18</span></span>
            </div>
          </div>
        </div>
      </div>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.toolBtn} aria-label="Ayarlar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <div className={styles.menuWrap}>
            <button type="button" className={styles.toolBtn} onClick={() => setMenuOpen((v) => !v)} aria-label="Diğer">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
            </button>
            {menuOpen && (
              <>
                <div className={styles.scrim} onClick={() => setMenuOpen(false)} />
                <div className={styles.menu}>
                  <button type="button" className={styles.menuItem} onClick={() => { setMenuOpen(false); setPhotoModalOpen(true) }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4h9" /><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Profili düzenle
                  </button>
                  <button type="button" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Profil bağlantısını kopyala
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <section>
          <div className={styles.sectionHead}><h3>Takipçiler</h3><span className={`${styles.muted} ${styles.seeAll}`} onClick={() => setListModal('followers')}>Tümünü göster</span></div>
          <div className={styles.scrollRow}>
            {topFriends.map((f) => (
              <div key={f.id} className={styles.friendTile}>
                <div className={styles.friendCircle} style={{ background: f.color }}>{f.initial}</div>
                <div className={styles.friendName}>{f.name}</div>
                <div className={styles.muted} style={{ fontSize: 13 }}>Profil</div>
              </div>
            ))}
          </div>
        </section>

        <div className={styles.hr} />

        <section>
          <div className={styles.sectionHead}><h3>Takip Edilen</h3><span className={`${styles.muted} ${styles.seeAll}`} onClick={() => setListModal('following')}>Tümünü göster</span></div>
          <div className={styles.scrollRow}>
            {following.map((f) => (
              <div key={f.id} className={styles.friendTile}>
                <div className={styles.friendCircle} style={{ background: f.color }}>{f.initial}</div>
                <div className={styles.friendName}>{f.name}</div>
                <div className={styles.muted} style={{ fontSize: 13 }}>Profil</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {listModal && (
        <div className={styles.fullModal} onClick={() => setListModal(null)}>
          <div className={styles.fullModalInner} onClick={(e) => e.stopPropagation()}>
            <div className={styles.fullModalHead}>
              <h2>{listModal === 'followers' ? 'Takipçiler' : 'Takip Edilen'}</h2>
              <button type="button" className={styles.fullModalClose} onClick={() => setListModal(null)} aria-label="Kapat">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className={styles.fullGrid}>
              {(listModal === 'followers' ? topFriends : following).map((f) => (
                <div key={f.id} className={styles.friendTile}>
                  <div className={styles.friendCircle} style={{ background: f.color }}>{f.initial}</div>
                  <div className={styles.friendName}>{f.name}</div>
                  <div className={styles.muted} style={{ fontSize: 13 }}>Profil</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Modal open={photoModalOpen} onClose={() => setPhotoModalOpen(false)} title="Profil fotoğrafı ve banner">
        <p className={styles.muted}>Fotoğraf yükleme, hesap sistemi eklendiğinde etkinleşecek.</p>
      </Modal>
    </div>
  )
}
