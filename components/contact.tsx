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
          <span className="tag">Próximo movimento</span>
          <h2>Vamos organizar o crescimento da sua marca.</h2>
          <p className="contactLead">Conte o momento da sua empresa. A primeira conversa começa pelo diagnóstico.</p>
          <a className="btn" href="https://wa.me/5531982988766?text=Ol%C3%A1!%20Vim%20pelo%20site%20da%20Cassiellos%20e%20quero%20agendar%20um%20diagn%C3%B3stico." target="_blank" rel="noopener noreferrer">
            Agendar diagnóstico
          </a>
        </Reveal>
      </div>
    </section>
  )
}
