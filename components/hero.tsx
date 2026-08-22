'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { EASE_OUT } from '@/lib/scroll'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import type { Locale } from './home-content'

const INFINITY_PATH = 'M5 16C5 9 10 5 16 5c8 0 11 11 16 11S40 5 48 5c6 0 11 4 11 11s-5 11-11 11c-8 0-11-11-16-11S24 27 16 27C10 27 5 23 5 16Z'

const ORBITS = [
  { id: 1, labelPt: 'Estratégia', labelEn: 'Strategy' },
  { id: 2, labelPt: 'Criação', labelEn: 'Creative' },
  { id: 3, labelPt: 'Operação', labelEn: 'Operations' },
] as const

type DragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

export default function Hero({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const ref = useRef<HTMLElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<DragState | null>(null)
  const symbolX = useMotionValue(0)
  const symbolY = useMotionValue(0)
  const [dragging, setDragging] = useState(false)
  const [revealCycle, setRevealCycle] = useState(0)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })
  const meshY = useTransform(smooth, [0, 1], ['0%', '18%'])
  const glowY = useTransform(smooth, [0, 1], ['0%', '-24%'])
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

  const replayReveal = () => {
    if (!reduced) setRevealCycle((cycle) => cycle + 1)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduced || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: symbolX.get(),
      originY: symbolY.get(),
    }
    setDragging(true)
    replayReveal()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragState.current
    const orbit = orbitRef.current
    if (!active || active.pointerId !== event.pointerId || !orbit) return
    const orbitBox = orbit.getBoundingClientRect()
    const symbolBox = event.currentTarget.getBoundingClientRect()
    const maxX = Math.max(0, (orbitBox.width - symbolBox.width) / 2)
    const maxY = Math.max(0, (orbitBox.height - symbolBox.height) / 2)
    const nextX = active.originX + event.clientX - active.startX
    const nextY = active.originY + event.clientY - active.startY
    symbolX.set(Math.max(-maxX, Math.min(maxX, nextX)))
    symbolY.set(Math.max(-maxY, Math.min(maxY, nextY)))
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return
    dragState.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const mainPathMotion = reduced ? {
    initial: false as const,
    animate: { pathLength: 1, opacity: 1 },
  } : {
    initial: { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1 },
    transition: {
      pathLength: { duration: 1.55, delay: 0.35, ease: EASE_OUT },
      opacity: { duration: 0.12, delay: 0.35, ease: EASE_OUT },
    },
  }

  return (
    <section className="hero" ref={ref}>
      <motion.i className="heroMesh" aria-hidden style={reduced ? still : { y: meshY }} />
      <motion.i className="heroGlow" aria-hidden style={reduced ? still : { y: glowY }} />
      <div className="wrap heroGrid">
        <motion.div style={reduced ? still : { y: copyY, opacity: copyOpacity }}>
          <motion.span className="tag" {...enter(0.05)}>Cassiellos / {en ? 'Creative operations' : 'Operações criativas'}</motion.span>
          <motion.h1 {...enter(0.12)}>{en ? 'Your business already works. Now it needs to work better.' : 'Sua empresa já funciona. Agora ela precisa funcionar melhor.'}</motion.h1>
          <motion.p className="lead" {...enter(0.2)}>{en ? 'We organize your marketing to create more opportunities and sales, with greater efficiency and clearer results, without you having to coordinate everything yourself.' : 'Organizamos seu marketing para gerar mais oportunidades e vendas, com mais eficiência, clareza sobre os resultados e sem você precisar coordenar tudo sozinho.'}</motion.p>
          <motion.div className="actions" {...enter(0.28)}>
            <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}</a>
            <a className="btn ghost" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'I want to organize my marketing' : 'Quero organizar meu marketing'}</a>
          </motion.div>
        </motion.div>

        <motion.div
          ref={orbitRef}
          className="orbit orbitInteractive"
          style={reduced ? still : { y: orbitY, scale: orbitScale }}
          {...(reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 1.1, delay: 0.15, ease: EASE_OUT } })}
        >
          <i className="infinityAmbient" aria-hidden />
          <i className="centerPulse" aria-hidden />
          <div className="orbitSystem" aria-hidden>
            {ORBITS.map((orbit) => (
              <div className={`orbitLayer orbitLayer${orbit.id}`} key={orbit.id}>
                <i className={`ring r${orbit.id} orbitRing`} />
                <span className={`orbitRotor orbitRotor${orbit.id}`}>
                  <span className={`orbitPayload orbitPayload${orbit.id}`}>
                    <i className="orbitDot" />
                    <span className="orbitCard">{en ? orbit.labelEn : orbit.labelPt}</span>
                  </span>
                </span>
              </div>
            ))}
          </div>

          <motion.div
            className={`infinityDrag${dragging ? ' isDragging' : ''}`}
            style={{ x: symbolX, y: symbolY }}
            onPointerEnter={replayReveal}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onLostPointerCapture={finishDrag}
            aria-label={en ? 'Interactive Cassiellos symbol. Hover to replay and drag to move.' : 'Símbolo interativo Cassiellos. Passe o mouse para repetir e arraste para mover.'}
          >
            <motion.div
              className="infinityFloat"
              animate={reduced ? undefined : { y: [0, -14, 0], scale: [0.97, 1.03, 1] }}
              transition={reduced ? undefined : {
                y: { duration: 5, delay: 2.3, ease: 'easeInOut', repeat: Infinity },
                scale: { duration: 0.48, delay: 1.8, times: [0, 0.48, 1], ease: EASE_OUT },
              }}
            >
              <svg className="infinityReveal infinityGlow" viewBox="0 0 64 32" aria-hidden focusable="false">
                <motion.path key={`glow-${revealCycle}`} d={INFINITY_PATH} pathLength={1} {...mainPathMotion} />
              </svg>
              <svg className="infinityReveal infinityMain" viewBox="0 0 64 32" aria-hidden focusable="false">
                <motion.path key={`main-${revealCycle}`} d={INFINITY_PATH} pathLength={1} {...mainPathMotion} />
              </svg>
              <svg className="infinityReveal infinityHighlight" viewBox="0 0 64 32" aria-hidden focusable="false">
                <motion.path
                  key={`highlight-${revealCycle}`}
                  d={INFINITY_PATH}
                  pathLength={1}
                  initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                  animate={reduced ? { opacity: 0 } : { pathLength: 1, opacity: [0, 0.42, 0] }}
                  transition={reduced ? undefined : {
                    pathLength: { duration: 1.49, delay: 0.53, ease: EASE_OUT },
                    opacity: { duration: 1.8, delay: 0.35, times: [0, 0.16, 1], ease: EASE_OUT },
                  }}
                />
              </svg>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
