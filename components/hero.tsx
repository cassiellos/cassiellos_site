'use client'

import { useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import InfinityMark from './infinity-mark'
import { EASE_OUT } from '@/lib/scroll'
import type { Locale } from './home-content'

export default function Hero({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const ref = useRef<HTMLElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)
  const [infinityHot, setInfinityHot] = useState(false)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })

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
            {en ? 'Clarity to decide.' : 'Clareza para decidir.'}
            <br />
            <span className="grad">{en ? 'Momentum to deliver.' : 'Ritmo para executar.'}</span>
          </motion.h1>

          <motion.p className="lead" {...enter(0.2)}>
            {en ? 'Strategy, creative and execution connected to transform marketing into a consistent, traceable operation built to grow.' : 'Estratégia, criação e execução conectadas para transformar marketing em uma operação consistente, rastreável e pronta para crescer.'}
          </motion.p>

          <motion.div className="actions" {...enter(0.28)}>
            <a className="btn" href="#contato">
              {en ? 'Schedule a diagnosis' : 'Agende um diagnóstico'}
            </a>
            <a className="btn ghost" href="#metodo">
              {en ? 'See how we work' : 'Ver como operamos'}
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          ref={orbitRef}
          className={`orbit orbitInteractive${infinityHot ? ' isInfinityHot' : ''}`}
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
          <div className="orbitSystem">
            <i className="ring r1" />
            <i className="ring r2" />
            <i className="ring r3" />
            <span className="labelOrbit labelOrbit1">
              <span className="orbitLabel">{en ? 'Strategy' : 'Estratégia'}</span>
            </span>
            <span className="labelOrbit labelOrbit2">
              <span className="orbitLabel">{en ? 'Creative' : 'Criação'}</span>
            </span>
            <span className="labelOrbit labelOrbit3">
              <span className="orbitLabel">{en ? 'Operations' : 'Operação'}</span>
            </span>
          </div>
          <motion.div
            className="infinityDrag"
            drag={!reduced}
            dragConstraints={orbitRef}
            dragElastic={0.16}
            dragMomentum
            dragTransition={{ bounceStiffness: 420, bounceDamping: 28 }}
            whileHover={reduced ? undefined : { scale: 1.045 }}
            whileDrag={reduced ? undefined : { scale: 1.08, cursor: 'grabbing' }}
            onHoverStart={() => setInfinityHot(true)}
            onHoverEnd={() => setInfinityHot(false)}
            aria-label={en ? 'Interactive Cassiellos symbol - drag to move' : 'Símbolo interativo Cassiellos - arraste para mover'}
          >
            <InfinityMark className="inf" />
            <InfinityMark className="inf loadingSweep" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
