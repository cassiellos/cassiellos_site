'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import Reveal from './reveal'

export default function Contact() {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 110, damping: 30, restDelta: 0.001 })
  const glowY = useTransform(smooth, [0, 1], ['22%', '-22%'])
  const glowScale = useTransform(smooth, [0, 0.5, 1], [0.9, 1.1, 0.9])

  return (
    <section className="section contact" id="contato" ref={ref}>
      <motion.i
        className="contactGlow"
        aria-hidden
        style={reduced ? undefined : { y: glowY, scale: glowScale }}
      />
      <div className="wrap">
        <Reveal>
          <span className="tag">Vamos organizar o próximo passo</span>
          <h2>Seu marketing pode funcionar como um sistema.</h2>
          <a className="btn" href="mailto:contato@agenciacassiellos.com.br" data-analytics-cta>
            Fale com a gente
          </a>
        </Reveal>
      </div>
    </section>
  )
}
