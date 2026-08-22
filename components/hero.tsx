'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import InfinityMark from './infinity-mark'
import { EASE_OUT } from '@/lib/scroll'

export default function Hero() {
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
            Cassiellos / Operações criativas
          </motion.span>

          <motion.h1 {...enter(0.12)}>
            Clareza para decidir.
            <br />
            <span className="grad">Ritmo para executar.</span>
          </motion.h1>

          <motion.p className="lead" {...enter(0.2)}>
            Estratégia, criação e execução conectadas para transformar marketing em uma operação
            consistente, rastreável e pronta para crescer.
          </motion.p>

          <motion.div className="actions" {...enter(0.28)}>
            <a className="btn" href="#contato">
              Agende um diagnóstico
            </a>
            <a className="btn ghost" href="#metodo">
              Ver como operamos
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
          <InfinityMark className="inf" />
          <i className="ring r1" />
          <i className="ring r2" />
          <i className="ring r3" />
          <span className="orbitLabel one">Estratégia</span>
          <span className="orbitLabel two">Criação</span>
          <span className="orbitLabel three">Operação</span>
        </motion.div>
      </div>
    </section>
  )
}
