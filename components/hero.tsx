'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { EASE_OUT } from '@/lib/scroll'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'

type Locale = 'pt' | 'en'

const INFINITY_PATH = 'M5 16C5 9 10 5 16 5c8 0 11 11 16 11S40 5 48 5c6 0 11 4 11 11s-5 11-11 11c-8 0-11-11-16-11S24 27 16 27C10 27 5 23 5 16Z'

const ORBITS = [
  { id: 1, angle: 42, duration: 20, direction: 1 },
  { id: 2, angle: 158, duration: 27, direction: -1 },
  { id: 3, angle: 268, duration: 36, direction: 1 },
] as const

export default function Hero({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })
  const meshY = useTransform(smooth, [0, 1], ['0%', '18%'])
  const orbitY = useTransform(smooth, [0, 1], ['0%', '-16%'])
  const orbitScale = useTransform(smooth, [0, 1], [1, 1.06])
  const copyY = useTransform(smooth, [0, 1], ['0%', '14%'])
  const copyOpacity = useTransform(smooth, [0, 0.85], [1, 0.25])
  const still = reduced ? {} : undefined

  const enter = (delay: number) => reduced ? {} : {
    initial: { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.85, delay, ease: EASE_OUT },
  }

  const pathReveal = reduced ? {
    initial: false as const,
    animate: { pathLength: 1 },
  } : {
    initial: { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: { duration: 1.55, delay: 0.35, ease: EASE_OUT },
  }

  return (
    <section className="hero" ref={ref} aria-labelledby="home-hero-title">
      <motion.i className="heroMesh" aria-hidden style={reduced ? still : { y: meshY }} />
      <div className="wrap heroGrid">
        <motion.div style={reduced ? still : { y: copyY, opacity: copyOpacity }}>
          <motion.span className="tag" {...enter(0.05)}>Cassiellos / {en ? 'Creative operations' : 'Operações criativas'}</motion.span>
          <motion.h1 id="home-hero-title" {...enter(0.12)}>
            {en ? <><span>Your company already works.</span> <span className="heroTitleGradient">Now it needs to work better.</span></> : <><span>Sua empresa já funciona.</span> <span className="heroTitleGradient">Agora ela precisa funcionar melhor.</span></>}
          </motion.h1>
          <motion.p className="lead" {...enter(0.2)}>
            {en ? 'We organize your marketing to create more opportunities and sales, with greater efficiency, clearer results and without you having to coordinate everything yourself.' : 'Organizamos seu marketing para gerar mais oportunidades e vendas, com mais eficiência, clareza sobre os resultados e sem você precisar coordenar tudo sozinho.'}
          </motion.p>
          <motion.div className="actions" {...enter(0.28)}>
            <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}</a>
            <a className="btn ghost" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'I want to organize my marketing' : 'Quero organizar meu marketing'}</a>
          </motion.div>
        </motion.div>

        <motion.div
          className="orbit infinityMasterStage"
          style={reduced ? still : { y: orbitY, scale: orbitScale }}
          {...(reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 1.1, delay: 0.15, ease: EASE_OUT } })}
        >
          <i className="infinityBlueGlow" aria-hidden />
          <div className="masterOrbitSystem" aria-hidden>
            {ORBITS.map((orbit) => (
              <motion.div
                className={`masterOrbitControl masterOrbitControl${orbit.id}`}
                key={orbit.id}
                initial={reduced ? false : { rotate: orbit.angle }}
                animate={{ rotate: reduced ? orbit.angle : orbit.angle + orbit.direction * 360 }}
                transition={reduced ? undefined : { duration: orbit.duration, delay: 2.2, ease: 'linear', repeat: Infinity }}
              >
                <motion.i
                  className={`masterOrbitRing masterOrbitRing${orbit.id}`}
                  initial={reduced ? false : { opacity: 0, scale: 0.84 }}
                  animate={{ opacity: orbit.id === 3 ? 0.13 : 0.16, scale: 1 }}
                  transition={reduced ? undefined : { duration: 0.9, delay: 1.98, ease: EASE_OUT }}
                />
                <motion.i
                  className={`masterOrbitDot masterOrbitDot${orbit.id}`}
                  initial={reduced ? false : { opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: reduced ? 1 : [0, 1.35, 1] }}
                  transition={reduced ? undefined : {
                    opacity: { duration: 0.72, delay: 2.2, ease: EASE_OUT },
                    scale: { duration: 0.72, delay: 2.2, times: [0, 0.583, 1], ease: EASE_OUT },
                  }}
                />
              </motion.div>
            ))}
          </div>

          <motion.div
            className="infinityMasterSymbol"
            animate={reduced ? undefined : {
              y: [0, -14, 0, 14, 0],
              scale: [0.97, 1.03, 1],
            }}
            transition={reduced ? undefined : {
              y: { duration: 5, delay: 2.3, times: [0, 0.25, 0.5, 0.75, 1], ease: 'linear', repeat: Infinity },
              scale: { duration: 0.48, delay: 1.8, times: [0, 0.479, 1], ease: EASE_OUT },
            }}
          >
            <motion.svg
              className="infinityMasterLayer infinityMasterMain"
              viewBox="0 0 64 32"
              aria-hidden
              focusable="false"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduced ? undefined : { duration: 0.24, delay: 0.23, ease: EASE_OUT }}
            >
              <motion.path d={INFINITY_PATH} pathLength={1} {...pathReveal} />
            </motion.svg>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
