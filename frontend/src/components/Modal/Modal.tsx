import type { ReactNode } from 'react'
import styles from './Modal.module.css'

export default function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} style={{ width }} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Kapat">✕</button>
        {title && <h3 className={styles.title}>{title}</h3>}
        {children}
      </div>
    </div>
  )
}
