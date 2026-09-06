import { Link } from 'react-router-dom'
import type { ReactNode, MouseEventHandler } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'light' | 'outline' | 'ghost'

interface ButtonProps {
  children: ReactNode
  variant?: Variant
  to?: string
  href?: string
  onClick?: MouseEventHandler
  type?: 'button' | 'submit'
  disabled?: boolean
  fullWidth?: boolean
}

export default function Button({ children, variant = 'primary', to, href, onClick, type = 'button', disabled, fullWidth }: ButtonProps) {
  const cls = `${styles.btn} ${styles[variant]} ${fullWidth ? styles.full : ''}`
  if (to) return <Link to={to} className={cls}>{children}</Link>
  if (href) return <a href={href} className={cls} onClick={onClick}>{children}</a>
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
