import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import Avatar from '../Avatar/Avatar'
import { activityFeed, notificationsSeed } from '../../mock/socialData'
import styles from './Navbar.module.css'

type ActivePage = 'home' | 'discover' | 'friends' | 'messages' | 'profile' | 'settings'

interface NavbarProps {
  active: ActivePage
  unreadMessages?: number
}

// Shared top nav used by Dashboard/Discover/Friends/Messages/Profile/AccountSettings.
// Ported from the Claude Design raw .dc.html source (Dashboard's fuller nav
// variant). Friend-activity + notifications are mock data (no social backend
// yet — see docs/PRODUCT.md).
export default function Navbar({ active, unreadMessages = 2 }: NavbarProps) {
  const [activityOpen, setActivityOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifList, setNotifList] = useState(notificationsSeed)
  const navigate = useNavigate()

  const links = [
    { to: '/dashboard', label: 'Ana Sayfa', key: 'home' as const, badge: 0 },
    { to: '/friends', label: 'Arkadaşlar', key: 'friends' as const, badge: 0 },
    { to: '/messages', label: 'Mesajlar', key: 'messages' as const, badge: unreadMessages },
  ]

  return (
    <nav className={styles.nav}>
      <Link to="/dashboard" className={styles.brand}>DUOVIE</Link>

      <div className={styles.links}>
        {links.map((l) => (
          <Link key={l.key} to={l.to} className={active === l.key ? styles.linkActive : styles.link}>
            <span className={l.badge ? styles.msgLink : undefined}>
              {l.label}
              {!!l.badge && <span className={styles.badge}>{l.badge}</span>}
            </span>
          </Link>
        ))}
      </div>

      <div className={styles.right}>
        <div className={styles.iconWrap}>
          <button type="button" className={styles.iconBtn} onClick={() => setActivityOpen((v) => !v)} aria-label="Arkadaş etkinliği">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
          {activityOpen && (
            <>
              <div className={styles.scrim} onClick={() => setActivityOpen(false)} />
              <div className={styles.activityPanel}>
                <div className={styles.panelHeader}>
                  <span>Arkadaş etkinliği</span>
                  <button onClick={() => setActivityOpen(false)} aria-label="Kapat">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                {activityFeed.map((f) => (
                  <div key={f.name} className={styles.activityRow}>
                    <Avatar initial={f.initial} color={f.color} size={46} statusColor={f.dotColor} />
                    <div className={styles.activityText}>
                      <div className={styles.activityTop}><span>{f.name}</span><span className={styles.muted}>{f.time}</span></div>
                      <div className={styles.muted}>{f.activity}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className={styles.iconWrap}>
          <button type="button" className={styles.iconBtn} onClick={() => setNotifOpen((v) => !v)} aria-label="Bildirimler">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className={styles.dot} />
          </button>
          {notifOpen && (
            <>
              <div className={styles.scrim} onClick={() => setNotifOpen(false)} />
              <div className={styles.notifPanel}>
                <div className={styles.panelHeader}>
                  <span>Bildirimler</span>
                  <button className={styles.textBtn} onClick={() => setNotifList([])}>Tümünü sil</button>
                </div>
                <div className={styles.notifList}>
                  {notifList.length === 0 && <div className={styles.emptyState}>Bildirim yok</div>}
                  {notifList.map((n) => (
                    <div key={n.id} className={styles.notifRow}>
                      <Avatar initial={n.initial} color={n.color} size={38} />
                      <div className={styles.activityText}>
                        <div><strong>{n.name}</strong> {n.text}</div>
                        <div className={styles.muted}>{n.time}</div>
                      </div>
                      {n.unread && <span className={styles.unreadDot} />}
                      <button className={styles.removeBtn} onClick={() => setNotifList((list) => list.filter((x) => x.id !== n.id))} aria-label="Kaldır">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.iconWrap}>
          <button type="button" className={styles.profileBtn} onClick={() => setProfileOpen((v) => !v)}>
            <Avatar initial="E" color="linear-gradient(135deg,var(--color-accent-700),var(--color-accent))" size={36} />
            <span className={styles.profileName}>Erdem</span>
          </button>
          {profileOpen && (
            <>
              <div className={styles.scrim} onClick={() => setProfileOpen(false)} />
              <div className={styles.profilePanel}>
                <div className={styles.profileHeader}>
                  <Avatar initial="E" color="linear-gradient(135deg,var(--color-accent-700),var(--color-accent))" size={38} />
                  <div>
                    <div className={styles.profileHeaderName}>Erdem</div>
                    <div className={styles.muted}>Seviye 12</div>
                  </div>
                </div>
                <div className={styles.menuItems}>
                  <Link to="/profile" className={styles.menuItem} onClick={() => setProfileOpen(false)}>Profilim</Link>
                  <Link to="/account-settings" className={styles.menuItem} onClick={() => setProfileOpen(false)}>Hesap Ayarları</Link>
                  <div className={styles.menuDivider} />
                  <button className={styles.menuItem} onClick={() => navigate('/')}>Çıkış Yap</button>
                </div>
              </div>
            </>
          )}
        </div>

        <button type="button" className={styles.mobileToggle} onClick={() => setMobileOpen((v) => !v)} aria-label="Menü">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
      </div>

      {mobileOpen && (
        <>
          <div className={styles.scrim} onClick={() => setMobileOpen(false)} />
          <div className={styles.mobileMenu}>
            <div className={styles.mobileMenuHead}>
              <div className={styles.brand}>DUOVIE</div>
              <button className={styles.mobileClose} onClick={() => setMobileOpen(false)} aria-label="Kapat">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {links.map((l) => (
              <Link key={l.key} to={l.to} className={active === l.key ? styles.mobileLinkActive : styles.mobileLink} onClick={() => setMobileOpen(false)}>
                {l.label}{!!l.badge && <span className={styles.badge}>{l.badge}</span>}
              </Link>
            ))}
          </div>
        </>
      )}
    </nav>
  )
}
