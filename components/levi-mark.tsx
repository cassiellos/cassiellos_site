import styles from './levi-mark.module.css'

type LeviMarkProps = {
  size?: 'small' | 'medium'
  className?: string
}

type LeviWordmarkProps = {
  compact?: boolean
  className?: string
}

export default function LeviMark({ size = 'medium', className = '' }: LeviMarkProps) {
  return (
    <span className={`${styles.mark} ${styles[size]} ${className}`.trim()} aria-hidden="true">
      <i className={`${styles.ring} ${styles.ringA}`} />
      <i className={`${styles.ring} ${styles.ringB}`} />
      <img className={styles.symbol} src="/brand/current/levi-symbol.png" alt="" />
    </span>
  )
}

export function LeviWordmark({ compact = false, className = '' }: LeviWordmarkProps) {
  return (
    <span className={`${styles.lockup} ${compact ? styles.compact : ''} ${className}`.trim()}>
      <span className={styles.wordmarkFrame} aria-hidden="true">
        <img className={styles.wordmarkPaper} src="/brand/current/levi-official-paper.png" alt="" />
        <img className={styles.wordmarkNavy} src="/brand/current/levi-official-navy.png" alt="" />
      </span>
      <span className={styles.by}>by CASSIELLOS</span>
    </span>
  )
}
