import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar/Navbar'
import Drawer from '../../components/Drawer/Drawer'
import Modal from '../../components/Modal/Modal'
import styles from './AccountSettings.module.css'

const tabs = [
  { id: 'hesap', label: 'Hesap' },
  { id: 'guvenlik', label: 'Güvenlik' },
  { id: 'bildirimler', label: 'Bildirimler' },
  { id: 'gizlilik', label: 'Gizlilik' },
  { id: 'baglı', label: 'Bağlı Hesaplar' },
  { id: 'veri', label: 'Veri ve Gizlilik' },
]

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  return '*'.repeat(local.length) + '@' + (domain || '')
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.toggle} data-on={on} onClick={onClick} disabled={disabled} aria-pressed={on}>
      <span className={styles.knob} />
    </button>
  )
}

// Mock content — no accounts backend yet (see docs/PRODUCT.md). The original
// source's multi-step email verification flow (OTP digit inputs + resend
// timers) is condensed here into a single edit-and-save modal, since there's
// no backend to actually send a verification code to. Ported from the
// Claude Design raw .dc.html source otherwise.
export default function AccountSettings() {
  const [tab, setTab] = useState('hesap')
  const [notif, setNotif] = useState({ messages: true, friends: true, invites: true, streak: true, achievements: true, system: true, email: false })
  const [privacy, setPrivacy] = useState({ publicProfile: true, showOnline: true, showActivity: false })
  const [connected, setConnected] = useState({ google: true, discord: false, twitch: false })
  const [showEmail, setShowEmail] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Kopyala')
  const [sessions, setSessions] = useState([
    { id: 1, name: 'Chrome · Windows', location: 'İstanbul, TR', time: 'şimdi aktif', current: true },
    { id: 2, name: 'Safari · iPhone 15', location: 'İstanbul, TR', time: '2 saat önce', current: false },
    { id: 3, name: 'Chrome · macOS', location: 'Ankara, TR', time: '3 gün önce', current: false },
  ])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [blocked, setBlocked] = useState([
    { id: 1, name: 'Kaan Y.', initial: 'K', color: '#a16207' },
    { id: 2, name: 'unknown_user42', initial: 'U', color: '#525252' },
  ])
  const [activity, setActivity] = useState([
    { id: 1, title: 'Interstellar izlendi', type: 'İzleme', time: 'Bugün, 21:40' },
    { id: 2, title: '"Film Gecesi" odası', type: 'Oda', time: 'Dün, 22:10' },
    { id: 3, title: 'Dune: Part Two izlendi', type: 'İzleme', time: '3 gün önce' },
    { id: 4, title: '"Aksiyon Kulübü" odası', type: 'Oda', time: '5 gün önce' },
    { id: 5, title: 'The Batman izlendi', type: 'İzleme', time: '1 hafta önce' },
  ])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editField, setEditField] = useState<'username' | 'email' | 'password' | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(text: string) {
    setToast(text)
    setTimeout(() => setToast(null), 2200)
  }
  function copyId() {
    navigator.clipboard?.writeText('DUO-77421-ERX')
    setCopyLabel('Kopyalandı')
    setTimeout(() => setCopyLabel('Kopyala'), 1500)
  }

  const notifRows: [keyof typeof notif, string, string][] = [
    ['messages', 'Mesajlar', 'Yeni mesaj aldığında bildir.'],
    ['friends', 'Arkadaşlık istekleri', 'Yeni arkadaşlık isteklerinde bildir.'],
    ['invites', 'Oda davetleri', 'Bir arkadaşın seni odasına davet ettiğinde bildir.'],
    ['streak', 'Streak', 'Serini kaybetmek üzereyken hatırlat.'],
    ['achievements', 'Başarımlar', 'Yeni bir başarım kazandığında bildir.'],
    ['email', 'E-posta bildirimleri', 'Önemli güncellemeleri e-posta ile de gönder.'],
  ]
  const privacyRows: [keyof typeof privacy, string, string][] = [
    ['publicProfile', 'Profilimi herkese açık yap', 'Diğer kullanıcılar profilini görüntüleyebilir.'],
    ['showOnline', 'Çevrimiçi durumumu göster', 'Arkadaşların ne zaman aktif olduğunu görsün.'],
    ['showActivity', 'İzleme etkinliğimi göster', 'Şu an ne izlediğini arkadaşlarınla paylaş.'],
  ]
  const connectedRows: [keyof typeof connected, string][] = [
    ['google', 'Google'],
    ['discord', 'Discord'],
    ['twitch', 'Twitch'],
  ]

  return (
    <div className={styles.page}>
      <Navbar active="settings" />
      <main className={styles.main}>
        <div className={styles.headRow}>
          <Link to="/dashboard" className={styles.backBtn} aria-label="Geri">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </Link>
          <h1>Hesap Ayarları</h1>
        </div>

        <div className={styles.layout}>
          <nav className={styles.tabs}>
            {tabs.map((t) => (
              <button key={t.id} className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
            <div className={styles.tabDivider} />
            <button className={`${styles.tab} ${styles.dangerTab} ${tab === 'sil' ? styles.tabActive : ''}`} onClick={() => setTab('sil')}>Hesabı Sil</button>
          </nav>

          <div className={styles.content}>
            {tab === 'hesap' && (
              <section>
                <h2>Hesap</h2>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Kullanıcı Adı</span>
                  <div className={styles.rowRight}>
                    <span className={styles.rowValue}>sadan1</span>
                    <span className={styles.rowBtn} onClick={() => setEditField('username')}>Düzenle</span>
                  </div>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>E-posta</span>
                  <div className={styles.rowRight}>
                    <span className={styles.rowValue}>
                      {showEmail ? 'sadan1@gmail.com' : maskEmail('sadan1@gmail.com')}
                      <a href="#" onClick={(e) => { e.preventDefault(); setShowEmail((v) => !v) }}>{showEmail ? 'Gizle' : 'Göster'}</a>
                    </span>
                    <span className={styles.rowBtn} onClick={() => setEditField('email')}>Düzenle</span>
                  </div>
                </div>
                <div className={styles.hr} />
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Hesap oluşturulma tarihi</span>
                  <span className={styles.rowValue}>14 Mart 2024</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Hesap doğrulama durumu</span>
                  <span className={styles.success}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    Doğrulandı
                  </span>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Hesap ID</span>
                  <span className={styles.mono} onClick={copyId}>
                    DUO-77421-ERX
                    {copyLabel === 'Kopyalandı'
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3ecf6e" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={styles.muted}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
                  </span>
                </div>
              </section>
            )}

            {tab === 'guvenlik' && (
              <section>
                <h2>Güvenlik</h2>
                <div className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>Şifre</div>
                    <div className={styles.muted}>••••••••</div>
                  </div>
                  <span className={styles.rowBtn} onClick={() => setEditField('password')}>Düzenle</span>
                </div>
                <div className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>İki adımlı doğrulama (2FA)<span className={styles.soonTag}>Yakında</span></div>
                    <div className={styles.muted}>Girişlerde ekstra güvenlik katmanı ekle.</div>
                  </div>
                  <Toggle on={false} onClick={() => {}} disabled />
                </div>
                <div className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>Aktif Oturumlar</div>
                    <div className={styles.muted}>{sessions.length} cihaz aktif</div>
                  </div>
                  <span className={styles.rowBtn} onClick={() => setSessionsOpen(true)}>Yönet →</span>
                </div>
                <div className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>Giriş Geçmişi</div>
                    <div className={styles.muted}>Son girişlerini görüntüle</div>
                  </div>
                  <span className={styles.rowBtn} onClick={() => setHistoryOpen(true)}>Tümünü gör →</span>
                </div>
              </section>
            )}

            {tab === 'bildirimler' && (
              <section>
                <h2>Bildirimler</h2>
                {notifRows.map(([key, label, desc]) => (
                  <div className={styles.row} key={key}>
                    <div><div className={styles.rowTitle}>{label}</div><div className={styles.muted}>{desc}</div></div>
                    <Toggle on={notif[key]} onClick={() => setNotif((n) => ({ ...n, [key]: !n[key] }))} />
                  </div>
                ))}
              </section>
            )}

            {tab === 'gizlilik' && (
              <section>
                <h2>Gizlilik</h2>
                {privacyRows.map(([key, label, desc]) => (
                  <div className={styles.row} key={key}>
                    <div><div className={styles.rowTitle}>{label}</div><div className={styles.muted}>{desc}</div></div>
                    <Toggle on={privacy[key]} onClick={() => setPrivacy((p) => ({ ...p, [key]: !p[key] }))} />
                  </div>
                ))}
                <div className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>Engellenen Kullanıcılar</div>
                    <div className={styles.muted}>{blocked.length} kullanıcı engellendi</div>
                  </div>
                  <span className={styles.rowBtn} onClick={() => setBlockedOpen(true)}>Yönet →</span>
                </div>
              </section>
            )}

            {tab === 'baglı' && (
              <section>
                <h2>Bağlı Hesaplar</h2>
                {connectedRows.map(([key, label]) => (
                  <div className={styles.row} key={key}>
                    <div><div className={styles.rowTitle}>{label}</div><div className={styles.muted}>{connected[key] ? 'Bağlı' : 'Bağlı değil'}</div></div>
                    <span className={styles.rowBtn} onClick={() => { setConnected((c) => ({ ...c, [key]: !c[key] })); showToast(connected[key] ? 'Bağlantı kaldırıldı' : 'Bağlandı') }}>{connected[key] ? 'Bağlantıyı Kaldır' : 'Bağla'}</span>
                  </div>
                ))}
              </section>
            )}

            {tab === 'veri' && (
              <section>
                <h2>Veri ve Gizlilik</h2>
                <div className={styles.row}>
                  <div><div className={styles.rowTitle}>Verilerimi indir</div><div className={styles.muted}>Profil ve etkinlik verilerinin bir özetini indir.</div></div>
                  <span className={styles.rowBtn} onClick={() => showToast('Değişiklikler kaydedildi')}>İndir</span>
                </div>
                <div className={styles.row}>
                  <div><div className={styles.rowTitle}>Aktivite geçmişini yönet</div><div className={styles.muted}>İzleme ve oda geçmişini görüntüle, düzenle veya temizle.</div></div>
                  <span className={styles.rowBtn} onClick={() => setActivityOpen(true)}>Yönet</span>
                </div>
                <div className={styles.row}>
                  <div><div className={styles.rowTitle}>Hesap verilerini dışa aktar</div><div className={styles.muted}>Tüm hesap verilerinin tam bir kopyasını e-posta ile talep et.</div></div>
                  <span className={styles.rowBtn} onClick={() => showToast('Dışa aktarma talebi e-postana gönderilecek')}>Talep Et</span>
                </div>
              </section>
            )}

            {tab === 'sil' && (
              <section>
                <h2 className={styles.dangerTitle}>Hesabı Sil</h2>
                <div className={styles.dangerBox}>
                  <div>
                    <div className={styles.dangerTitle}>Bu işlem geri alınamaz</div>
                    <p className={styles.muted}>Hesabını sildiğinde tüm izleme geçmişin, odaların ve arkadaş listen kalıcı olarak silinir.</p>
                  </div>
                  <a href="#" className="btn btn-primary" style={{ borderRadius: 24, padding: '10px 20px', flex: 'none' }} onClick={(e) => { e.preventDefault(); setDeleteOpen(true) }}>Hesabımı Sil</a>
                </div>
                <div className={styles.row}>
                  <div><div className={styles.rowTitle}>Hesabı devre dışı bırak</div><p className={styles.muted}>Hesabını geçici olarak gizle; istediğin zaman geri dön.</p></div>
                  <span className={styles.rowBtn} onClick={() => showToast('Hesabı devre dışı bırakma isteği alındı')}>Devre Dışı Bırak</span>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      <Drawer open={sessionsOpen} onClose={() => setSessionsOpen(false)} title="Aktif Oturumlar">
        <p className={styles.muted} style={{ marginBottom: 18 }}>Hesabına giriş yapılmış tüm cihazlar.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <span className={styles.rowBtn} onClick={() => setSessions((s) => s.filter((d) => d.current))}>Tüm cihazlardan çıkış</span>
        </div>
        {sessions.map((s) => (
          <div className={styles.drawerRow} key={s.id}>
            <div><div className={styles.rowTitle}>{s.name} {s.current && <span className={styles.successTag}>Bu cihaz</span>}</div><div className={styles.muted}>{s.location} · {s.time}</div></div>
            {!s.current && <span className={styles.rowBtn} onClick={() => setSessions((list) => list.filter((d) => d.id !== s.id))}>Çıkış yap</span>}
          </div>
        ))}
      </Drawer>

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Giriş Geçmişi">
        {[
          { result: 'Başarılı giriş', device: 'Chrome · Windows', location: 'İstanbul, TR', time: 'şimdi' },
          { result: 'Başarılı giriş', device: 'Safari · iPhone 15', location: 'İstanbul, TR', time: '2 sa önce' },
          { result: 'Başarısız deneme', device: 'Bilinmeyen tarayıcı', location: 'Sofya, BG', time: '1 gün önce' },
          { result: 'Başarılı giriş', device: 'Chrome · macOS', location: 'Ankara, TR', time: '3 gün önce' },
          { result: 'Başarılı giriş', device: 'Chrome · Windows', location: 'İstanbul, TR', time: '6 gün önce' },
          { result: 'Şifre değiştirildi', device: 'Chrome · Windows', location: 'İstanbul, TR', time: '2 hafta önce' },
        ].map((h, i) => (
          <div className={styles.drawerRow} key={i}><span style={{ fontSize: 13 }}><strong>{h.result}</strong> · {h.device} · {h.location}</span><span className={styles.muted} style={{ flex: 'none' }}>{h.time}</span></div>
        ))}
      </Drawer>

      <Drawer open={blockedOpen} onClose={() => setBlockedOpen(false)} title="Engellenen Kullanıcılar">
        <p className={styles.muted} style={{ marginBottom: 8 }}>Engellediğin kullanıcılar sana mesaj gönderemez veya odalarına davet edemez.</p>
        {blocked.length === 0 && <div className={styles.muted} style={{ padding: '32px 0', textAlign: 'center', fontSize: 14, borderTop: '1px solid var(--color-divider)' }}>Engellediğin kimse yok.</div>}
        {blocked.map((b) => (
          <div className={styles.drawerRow} key={b.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: b.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#fff', flex: 'none' }}>{b.initial}</div>
              <div className={styles.rowTitle}>{b.name}</div>
            </div>
            <span className={styles.rowBtn} onClick={() => setBlocked((list) => list.filter((x) => x.id !== b.id))}>Engeli Kaldır</span>
          </div>
        ))}
      </Drawer>

      <Drawer open={activityOpen} onClose={() => setActivityOpen(false)} title="Aktivite Geçmişi">
        <p className={styles.muted} style={{ marginBottom: 18 }}>İzleme ve oda geçmişin.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <span className={styles.rowBtn} onClick={() => setActivity([])}>Tümünü Temizle</span>
        </div>
        {activity.length === 0 && <div className={styles.muted} style={{ padding: '32px 0', textAlign: 'center', fontSize: 14, borderTop: '1px solid var(--color-divider)' }}>Aktivite geçmişin boş.</div>}
        {activity.map((a) => (
          <div className={styles.drawerRow} key={a.id}><div><div className={styles.rowTitle}>{a.title}</div><div className={styles.muted}>{a.type} · {a.time}</div></div><span className={styles.rowBtn} onClick={() => setActivity((list) => list.filter((x) => x.id !== a.id))}>Sil</span></div>
        ))}
      </Drawer>

      <Modal open={editField !== null} onClose={() => setEditField(null)} title={editField === 'password' ? 'Şifreni güncelle' : editField === 'email' ? 'E-postanı değiştir' : 'Kullanıcı adını değiştir'}>
        <div className={styles.modalForm}>
          {editField === 'password' ? (
            <>
              <input type="password" placeholder="Mevcut Şifren" className={styles.modalInput} />
              <input type="password" placeholder="Yeni Şifre" className={styles.modalInput} />
              <input type="password" placeholder="Yeni Şifreyi Onayla" className={styles.modalInput} />
            </>
          ) : (
            <>
              <input type={editField === 'email' ? 'email' : 'text'} placeholder="Yeni değer" className={styles.modalInput} />
              <input type="password" placeholder="Mevcut Şifren" className={styles.modalInput} />
            </>
          )}
          <div className={styles.modalActions}>
            <a href="#" className="btn btn-secondary" style={{ borderRadius: 24, padding: '10px 20px' }} onClick={(e) => { e.preventDefault(); setEditField(null) }}>İptal</a>
            <a href="#" className="btn" style={{ borderRadius: 24, padding: '10px 20px', background: '#fff', color: '#111' }} onClick={(e) => { e.preventDefault(); setEditField(null); showToast('Değişiklikler kaydedildi') }}>Bitti</a>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Hesabını silmek istediğine emin misin?">
        <p className={styles.muted}>Bu işlem geri alınamaz ve tüm verilerin silinir.</p>
        <div className={styles.modalActions}>
          <a href="#" className="btn btn-secondary" style={{ borderRadius: 24, padding: '10px 20px' }} onClick={(e) => { e.preventDefault(); setDeleteOpen(false) }}>Vazgeç</a>
          <a href="#" className="btn btn-primary" style={{ borderRadius: 24, padding: '10px 20px' }} onClick={(e) => { e.preventDefault(); setDeleteOpen(false) }}>Sil</a>
        </div>
      </Modal>

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  )
}
