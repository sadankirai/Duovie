import { Link, useNavigate } from 'react-router-dom'
import { useRoomSession } from '../../features/room/session'
import styles from './Lobby.module.css'

// Real integration: the RoomSession resolved by useRoomSession (created on
// Dashboard, or resumed from storage) is carried through to Room via router state.
export default function Lobby() {
  const { session, roomId, error } = useRoomSession()
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.brandWrap}>
        <div className={styles.brand}>DUOVIE</div>
      </div>

      <div className={styles.body}>
        <div className={styles.heading}>
          <div className={styles.title}>Odanı Hazırla</div>
          <div className={styles.muted}>Bugün birlikte ne yapıyoruz?</div>
        </div>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.grid}>
          <button
            type="button"
            className={styles.card}
            disabled={!session}
            onClick={() => navigate(`/room/${roomId}?share=1`, { state: { session } })}
          >
            <div className={styles.iconWrap}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
            </div>
            <div className={styles.cardTitle}>Ekranı Paylaş</div>
            <p className={styles.cardBody}>Kendi ekranını arkadaşınla paylaş.</p>
            <span className={styles.cta}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              Paylaşımı Başlat
            </span>
          </button>

          <div className={styles.card} aria-disabled="true">
            <div className={styles.iconWrap}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            </div>
            <div className={styles.cardTitleRow}>
              <span className={styles.cardTitle}>Birlikte İzle</span>
              <span className={styles.soon}>Yakında</span>
            </div>
            <p className={styles.cardBody}>Dış platformlarda kendi hesabınızla senkronize izleyin.</p>
            <button type="button" className={styles.cta} disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
              Bağlan
            </button>
          </div>

          <div className={styles.card} aria-disabled="true">
            <div className={styles.iconWrap}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-400)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
            </div>
            <div className={styles.cardTitleRow}>
              <span className={styles.cardTitle}>Duovie Player</span>
              <span className={styles.soon}>Yakında</span>
            </div>
            <p className={styles.cardBody}>Duovie'nin kendi oynatıcı altyapısıyla izleyin.</p>
            <button type="button" className={styles.cta} disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
              Oynat
            </button>
          </div>
        </div>

        <Link to="/dashboard" className={styles.leave}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          Vazgeç ve odadan çık
        </Link>
      </div>
    </div>
  )
}
