import { useEffect, useState } from 'react'
import styles from './Landing.module.css'

const faqs = [
  { q: 'Duovie nasıl çalışır?', a: 'Duovie, farklı yerlerdeki arkadaşların aynı deneyimde buluşmasını sağlar. Bir oda oluşturun, arkadaşınızı davet edin ve birlikte içerik izlemeye, sohbet etmeye veya vakit geçirmeye başlayın.' },
  { q: 'Arkadaşımı nasıl davet ederim?', a: 'Bir oda oluşturduktan sonra oluşan davet bağlantısını arkadaşınızla paylaşmanız yeterli. Arkadaşınız bağlantıyı açarak doğrudan odanıza katılabilir.' },
  { q: 'Duovie ile neler yapabilirim?', a: 'Duovie ile arkadaşınızla içerikleri senkronize izleyebilir, sohbet edebilir, birlikte vakit geçirebilir ve aynı deneyimi uzaktan paylaşabilirsiniz. Zamanla daha fazla birlikte deneyim de eklemeyi planlıyoruz.' },
  { q: 'Arkadaşım farklı bir şehirde veya ülkede olabilir mi?', a: "Evet. Duovie'nin amacı, fiziksel olarak farklı yerlerde bulunan insanları aynı deneyimde buluşturmaktır. Nerede olursanız olun arkadaşınızla birlikte vakit geçirebilirsiniz." },
  { q: 'Aynı anda kaç kişi kullanabilir?', a: 'Duovie, iki kişilik deneyim için tasarlanmıştır. Her odada bir ev sahibi ve bir misafir bulunur; böylece deneyim tamamen iki kişi üzerine kuruludur.' },
  { q: 'Duovie ücretsiz mi?', a: "Şu anda Duovie'yi ücretsiz olarak kullanabilirsiniz. Ücretli üyelik veya abonelik sistemi bulunmuyor." },
]

const steps = ['Odanı oluştur', 'Arkadaşını davet et', 'İzlemeye başlayın']

const features = [
  { n: 1, title: 'Aynı anda izleyin', body: 'Oynat, durdur, geri sar. Her şey senkronize.', img: 'how-1.png', indent: false },
  { n: 2, title: 'İzlerken Sohbet Edin', body: 'İsterseniz sesli ve görüntülü konuşun.', img: 'how-2.png', indent: true },
  { n: 3, title: 'Özel Odanı Oluştur', body: 'Kendi odanızı oluşturun, arkadaşınızı davet edin.', img: 'how-4.png', indent: true },
  { n: 4, title: 'Birlikte Keşfedin', body: 'Hemen aramıza katıl, daha fazlası seni bekliyor.', img: 'how-3.png', indent: true },
]

const platformLogos = [
  { name: 'Netflix', file: 'netflix.svg', style: { height: 50, filter: 'brightness(0) saturate(100%) invert(15%) sepia(90%) saturate(4000%) hue-rotate(350deg)' } },
  { name: 'YouTube', file: 'youtube.svg', style: { height: 180 } },
  { name: 'Disney+', file: 'disney.svg', style: { height: 90, filter: 'brightness(0) invert(1)' } },
  { name: 'HBO', file: 'hbo.svg', style: { height: 50, filter: 'brightness(0) invert(1)' } },
  { name: 'Amazon', file: 'amazon.svg', style: { height: 50, filter: 'brightness(0) invert(1)' } },
]

// Login/register here are a visual shell only — Duovie has no accounts/auth
// backend yet (accounts are explicitly out of MVP scope, see docs/PRODUCT.md).
// Ported directly from the Claude Design raw .dc.html source; the language
// menu and auth-modal state below mirror that source's own DCLogic state 1:1.
export default function Landing() {
  const [lang, setLang] = useState<'Türkçe' | 'English'>('Türkçe')
  const [langOpen, setLangOpen] = useState(false)
  const [hoverLang, setHoverLang] = useState<'Türkçe' | 'English' | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  useEffect(() => {
    if (!langOpen) return
    const onDocClick = () => setLangOpen(false)
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [langOpen])

  useEffect(() => {
    document.documentElement.style.overflow = authMode ? 'hidden' : ''
    document.body.style.overflow = authMode ? 'hidden' : ''
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [authMode])

  const trBg = (hoverLang ? hoverLang === 'Türkçe' : lang === 'Türkçe') ? '#e5e5e5' : '#fff'
  const enBg = (hoverLang ? hoverLang === 'English' : lang === 'English') ? '#e5e5e5' : '#fff'

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroBg} style={{ backgroundImage: 'url(/assets/hero-cinema-cat.png)' }} />
        <div className={styles.heroOverlay} />

        <nav className={styles.nav}>
          <div className={styles.brand}>DUOVIE</div>
          <div className={styles.navRight}>
            <div className={styles.langWrap} onClick={(e) => e.stopPropagation()}>
              <div className={styles.langBtn} onClick={() => setLangOpen((v) => !v)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbe4ce" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M5 8h10M9 5v3a9 9 0 0 1-6 8" /><path d="M13 21l4-9 4 9M14.5 18h5" /></svg>
                <span style={{ flex: 1 }}>{lang}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbe4ce" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', transform: langOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {langOpen && (
                <div className={styles.langMenu}>
                  <div
                    className={styles.langOption}
                    style={{ background: trBg }}
                    onClick={() => { setLang('Türkçe'); setLangOpen(false) }}
                    onMouseEnter={() => setHoverLang('Türkçe')}
                    onMouseLeave={() => setHoverLang(null)}
                  >Türkçe</div>
                  <div
                    className={styles.langOption}
                    style={{ background: enBg }}
                    onClick={() => { setLang('English'); setLangOpen(false) }}
                    onMouseEnter={() => setHoverLang('English')}
                    onMouseLeave={() => setHoverLang(null)}
                  >English</div>
                </div>
              )}
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('login') }} className={`btn btn-primary ${styles.loginBtn}`}>Oturum Aç</a>
          </div>
        </nav>

        <section className={styles.heroSection}>
          <div className={styles.heroInner}>
            <h1>Farklı yerlerde, aynı anda birlikte</h1>
            <p className={styles.heroLead}>Duovie ile arkadaşlarınızla aynı içeriği senkronize izleyin, sesli sohbet edin ve anı birlikte paylaşın.</p>
            <p className={styles.heroSub}>İzlemeye hazır mısınız? Hemen katılın, arkadaşınızı davet edin ve birlikte izlemeye başlayın.</p>
            <div className={styles.heroCtaWrap}>
              <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('register') }} className={`btn btn-primary ${styles.heroCta}`}>
                Hemen Katıl
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </a>
            </div>
          </div>
        </section>

        <svg viewBox="0 0 1440 90" preserveAspectRatio="none" className={styles.wave}>
          <path d="M0,85 Q720,10 1440,80 L1440,90 L0,90 Z" fill="var(--color-bg)" />
          <path d="M0,85 Q720,10 1440,80" fill="none" stroke="var(--color-accent)" strokeWidth={3} />
        </svg>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <h2>Nasıl Çalışır?</h2>
          <div className={styles.stepsBar}>
            {steps.map((s, i) => (
              <div key={s} style={{ display: 'contents' }}>
                {i > 0 && <div className={styles.stepDivider} />}
                <div className={styles.step}>{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <img src="/assets/halftone-line.png" alt="" className={styles.halftone} />
        <div className={styles.sectionInner} style={{ position: 'relative', zIndex: 1 }}>
          <h2>Herkesle, her yerden, birlikte</h2>
          <div className={styles.featureGrid}>
            {features.map((f) => (
              <div key={f.n} className={styles.featureCard} style={{ backgroundImage: `linear-gradient(0deg,rgba(0,0,0,0.75),rgba(0,0,0,0.35)),url(/assets/${f.img})` }}>
                <div className={f.indent ? styles.featureContentIndent : styles.featureContent}>
                  <div className={`card-title ${styles.featureTitle}`}>{f.title}</div>
                  <p className={`card-body ${styles.featureBody}`}>{f.body}</p>
                </div>
                <span className={styles.featureNum}>{f.n}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <h2>Zaten kullandığınız platformlarla birlikte</h2>
          <div className={styles.logoRow}>
            {platformLogos.map((l) => (
              <img key={l.name} src={`/assets/logos/${l.file}`} alt={l.name} style={{ width: 'auto', ...l.style }} />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <h2>Sık sorulan sorular</h2>
          <div className={styles.faqList}>
            {faqs.map((f) => (
              <details key={f.q} name="faq" className={styles.faqItem}>
                <summary>
                  {f.q}
                  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </summary>
                <p className="text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalCtaGlow} />
        <div className={styles.finalCtaInner}>
          <h2>Mesafe ne olursa olsun, birlikte başlayın</h2>
          <p className="text-muted">Arkadaşını davet et ve Duovie ile birlikte vakit geçirmeye başla.</p>
          <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('register') }} className={`btn btn-primary ${styles.finalCtaBtn}`}>
            Hemen Katıl
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          </a>
        </div>
      </section>

      {authMode === 'register' && (
        <section className={styles.authOverlay}>
          <div className={styles.authGlow} />
          <button type="button" onClick={() => setAuthMode(null)} className={styles.authClose} aria-label="Kapat">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className={`duovie-auth-card ${styles.authCard}`}>
            <div className={styles.authBrand}>DUOVIE</div>
            <h2 className={styles.authTitle}>Hesabını oluştur</h2>
            <p className={styles.authSub}>Arkadaşını davet et, birlikte izlemeye başla.</p>
            <button type="button" className={styles.googleBtn}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.9 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13.5 24 13.5c3.1 0 5.8 1.1 8 3l6-6C34.5 6.5 29.5 4.5 24 4.5c-7.6 0-14.1 4.3-17.7 10.2z" /><path fill="#4CAF50" d="M24 44.5c5.4 0 10.3-1.8 14-5l-6.5-5.5c-2 1.4-4.6 2.3-7.5 2.3-5.4 0-9.9-3.1-11.4-7.8l-6.6 5C9.8 40 16.3 44.5 24 44.5z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 3-3.1 5.4-5.8 7l6.5 5.5C39.7 37.4 44.5 31.6 44.5 24c0-1.2-.1-2.4-.9-3.5z" /></svg>
              Google ile Kayıt Ol
            </button>
            <div className={styles.divider}><div className={styles.dividerLine} /><span className={styles.dividerText}>veya</span><div className={styles.dividerLine} /></div>
            <form className={styles.authForm} onSubmit={(e) => e.preventDefault()}>
              <input type="text" placeholder="Ad Soyad" className={styles.authInput} />
              <input type="email" placeholder="E-posta" className={styles.authInput} />
              <input type="password" placeholder="Şifre" className={styles.authInput} />
              <label className={styles.checkboxRow}>
                <input type="checkbox" style={{ width: 18, height: 18, accentColor: 'var(--color-accent)', flex: 'none' }} />
                <span className={styles.checkboxText}>Kullanım koşullarını okudum ve kabul ediyorum.</span>
              </label>
              <button type="submit" className={`btn btn-primary ${styles.authSubmit}`}>Hesap Oluştur</button>
            </form>
            <p className={styles.authSwitch}>Zaten hesabın var mı? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('login') }}>Oturum aç</a></p>
          </div>
        </section>
      )}

      {authMode === 'login' && (
        <section className={styles.authOverlay}>
          <div className={styles.authGlow} />
          <button type="button" onClick={() => setAuthMode(null)} className={styles.authClose} aria-label="Kapat">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className={`duovie-auth-card ${styles.authCard}`}>
            <div className={styles.authBrand}>DUOVIE</div>
            <h2 className={styles.authTitle}>Oturum Aç</h2>
            <p className={styles.authSub}>Tekrar hoş geldin, izlemeye devam et.</p>
            <button type="button" className={styles.googleBtn}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.9 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13.5 24 13.5c3.1 0 5.8 1.1 8 3l6-6C34.5 6.5 29.5 4.5 24 4.5c-7.6 0-14.1 4.3-17.7 10.2z" /><path fill="#4CAF50" d="M24 44.5c5.4 0 10.3-1.8 14-5l-6.5-5.5c-2 1.4-4.6 2.3-7.5 2.3-5.4 0-9.9-3.1-11.4-7.8l-6.6 5C9.8 40 16.3 44.5 24 44.5z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 3-3.1 5.4-5.8 7l6.5 5.5C39.7 37.4 44.5 31.6 44.5 24c0-1.2-.1-2.4-.9-3.5z" /></svg>
              Google ile Oturum Aç
            </button>
            <div className={styles.divider}><div className={styles.dividerLine} /><span className={styles.dividerText}>veya</span><div className={styles.dividerLine} /></div>
            <form className={styles.authForm} onSubmit={(e) => e.preventDefault()}>
              <input type="email" placeholder="E-posta" className={styles.authInput} />
              <input type="password" placeholder="Şifre" className={styles.authInput} />
              <button type="submit" className={`btn btn-primary ${styles.authSubmit}`}>Oturum Aç</button>
            </form>
            <p className={styles.authSwitch}>Hesabın yok mu? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('register') }}>Kayıt ol</a></p>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <div className={styles.footerBrand}>DUOVIE</div>
            <p className={styles.footerMuted}>Birlikte izlemenin en kolay yolu.</p>
          </div>
          <p className={styles.footerMuted}>© 2026 Duovie. Tüm hakları saklıdır.</p>
        </div>
      </footer>
    </div>
  )
}
