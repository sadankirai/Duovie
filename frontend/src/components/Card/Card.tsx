import type { ReactNode, CSSProperties } from 'react'
import styles from './Card.module.css'

export default function Card({ children, accent, style }: { children: ReactNode; accent?: boolean; style?: CSSProperties }) {
  return (
    <div className={`${styles.card} ${accent ? styles.accent : ''}`} style={style}>
      {children}
    </div>
  )
}
