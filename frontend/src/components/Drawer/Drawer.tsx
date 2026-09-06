import type { ReactNode } from 'react'
import styles from './Drawer.module.css'

export default function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span>{title}</span>
          <button onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  )
}
