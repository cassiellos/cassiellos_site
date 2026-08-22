'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import InfinityMark from './infinity-mark'
import { EASE_OUT } from '@/lib/scroll'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import type { Locale } from './home-content'

export default function Hero({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })

  // Camadas em velocidades diferentes: fundo desce, órbita sobe, texto acompanha.
  const meshY = useTransform(smooth, [0, 1], ['0%', '18%'])
  const glowY = useTransform(smooth, [0, 1], ['0%', '-24%'])
  const orbitY = useTransform(smooth, [0, 1], ['0%', '-16%'])
  const orbitScale = useTransform(smooth, [0, 1], [1, 1.06])
  const copyY = useTransform(smooth, [0, 1], ['0%', '14%'])
  const copyOpacity = useTransform(smooth, [0, 0.85], [1, 0.25])

  const still = reduced ? {} : undefined

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.85, delay, ease: EASE_OUT },
        }

  return (
    <section className="hero" ref={ref}>
      <motion.i className="heroMesh" aria-hidden style={reduced ? still : { y: meshY }} />
      <motion.i className="heroGlow" aria-hidden style={reduced ? still : { y: glowY }} />

      <div className="wrap heroGrid">
        <motion.div style={reduced ? still : { y: copyY, opacity: copyOpacity }}>
          <motion.span className="tag" {...enter(0.05)}>
            Cassiellos / {en ? 'Creative operations' : 'Operações criativas'}
          </motion.span>

          <motion.h1 {...enter(0.12)}>
            {en ? 'Your business already works. Now it needs to work better.' : 'Sua empresa já funciona. Agora ela precisa funcionar melhor.'}
          </motion.h1>

          <motion.p className="lead" {...enter(0.2)}>
            {en ? 'We organize your marketing to create more opportunities and sales, with greater efficiency and clearer results, without you having to coordinate everything yourself.' : 'Organizamos seu marketing para gerar mais oportunidades e vendas, com mais eficiência, clareza sobre os resultados e sem você precisar coordenar tudo sozinho.'}
          </motion.p>

          <motion.div className="actions" {...enter(0.28)}>
            <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
              {en ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}
            </a>
            <a className="btn ghost" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
              {en ? 'I want to organize my marketing' : 'Quero organizar meu marketing'}
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          className="orbit"
          style={reduced ? still : { y: orbitY, scale: orbitScale }}
          {...(reduced
            ? {}
            : {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: { duration: 1.1, delay: 0.15, ease: EASE_OUT },
              })}
        >
          <i className="centerPulse" aria-hidden />
          <InfinityMark className="inf" />
          <i className="ring r1" />
          <i className="ring r2" />
          <i className="ring r3" />
          <span className="orbitLabel one">{en ? 'Strategy' : 'Estratégia'}</span>
          <span className="orbitLabel two">{en ? 'Creative' : 'Criação'}</span>
          <span className="orbitLabel three">{en ? 'Operations' : 'Operação'}</span>
        </motion.div>
      </div>
    </section>
  )
}
