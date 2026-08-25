import styles from './levi-mark.module.css'

type LeviMarkProps = {
  size?: 'small' | 'medium'
  className?: string
}

export default function LeviMark({ size = 'medium', className = '' }: LeviMarkProps) {
  return (
    <span className={`${styles.mark} ${styles[size]} ${className}`.trim()} aria-hidden="true">
      <i className={`${styles.ring} ${styles.ringA}`} />
      <i className={`${styles.ring} ${styles.ringB}`} />
      <i className={styles.core} />
    </span>
  )
}
