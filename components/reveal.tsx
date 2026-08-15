'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '@/lib/scroll'

const TAGS = {
  div: motion.div,
  article: motion.article,
  section: motion.section,
  header: motion.header,
  p: motion.p,
  span: motion.span,
} as const

type Tag = keyof typeof TAGS

type RevealProps = {
  children: ReactNode
  as?: Tag
  className?: string
  /** atraso em segundos — usado para escalonar grupos */
  delay?: number
  /** distância vertical inicial */
  y?: number
  id?: string
  style?: React.CSSProperties
  onMouseMove?: React.MouseEventHandler<HTMLElement>
}

/**
 * Entrada por rolagem: sobe e revela uma única vez, com respeito a
 * `prefers-reduced-motion` (nesse caso o conteúdo simplesmente aparece).
 */
export default function Reveal({
  children,
  as = 'div',
  className,
  delay = 0,
  y = 26,
  id,
  style,
  onMouseMove,
}: RevealProps) {
  const reduced = useReducedMotion()
  const Component = TAGS[as]

  if (reduced) {
    return (
      <Component className={className} id={id} style={style} onMouseMove={onMouseMove}>
        {children}
      </Component>
    )
  }

  return (
    <Component
      className={className}
      id={id}
      style={style}
      onMouseMove={onMouseMove}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: '0px 0px -6% 0px' }}
      transition={{ duration: 0.75, delay, ease: EASE_OUT }}
    >
      {children}
    </Component>
  )
}
