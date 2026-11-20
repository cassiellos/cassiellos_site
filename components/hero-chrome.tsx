'use client'

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '@/lib/scroll'
import WhatsappCta from './whatsapp-cta'
import { INFINITY_PATH } from './infinity-mark'
import styles from './home-v3.module.css'

type Locale = 'pt' | 'en'

/** Camadas de profundidade do símbolo 3D (a primeira é a face cromada). */
const LAYERS = 14

export default function HeroChrome({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const reduced = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)

  // Inclinação do símbolo acompanhando o ponteiro, sem re-render (variáveis CSS).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || reduced) return
    const fine = window.matchMedia('(pointer: fine)').matches
    if (!fine) return
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - 0.5
        const y = event.clientY / window.innerHeight - 0.5
        stage.style.setProperty('--tilt-x', `${(-y * 14).toFixed(2)}deg`)
        stage.style.setProperty('--tilt-y', `${(x * 22).toFixed(2)}deg`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [reduced])

  const enter = (delay: number) => reduced ? {} : {
    initial: { opacity: 0, y: 26 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay, ease: EASE_OUT },
  }

  return (
    <section className={styles.hero} aria-labelledby="home-hero-title">
      <div className={styles.room} aria-hidden="true">
        <i className={styles.roomCeiling} />
        <i className={styles.roomFloor} />
        <i className={styles.roomGlow} />
      </div>

      <div className={`wrap ${styles.heroInner}`}>
        <motion.div
          ref={stageRef}
          className={styles.symbolStage}
          aria-hidden="true"
          {...(reduced ? {} : { initial: { opacity: 0, scale: 0.86 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 1.1, ease: EASE_OUT } })}
        >
          <div className={`${styles.symbol3d} ${reduced ? '' : styles.symbolSway}`}>
            {Array.from({ length: LAYERS }, (_, index) => {
              const depth = LAYERS - 1 - index
              const front = depth === 0
              return (
                <svg
                  key={depth}
                  className={front ? styles.symbolFace : styles.symbolDepth}
                  viewBox="0 0 64 32"
                  focusable="false"
                  style={{ transform: `translateZ(${-depth * 1.6}px)`, opacity: front ? 1 : 1 - depth / (LAYERS * 1.6) }}
                >
                  {front && (
                    <defs>
                      <linearGradient id="cassiellos-chrome" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#ffd3d7" />
                        <stop offset="0.22" stopColor="#ff6b77" />
                        <stop offset="0.48" stopColor="#f13c4b" />
                        <stop offset="0.62" stopColor="#8f1622" />
                        <stop offset="0.8" stopColor="#ff8a94" />
                        <stop offset="1" stopColor="#f13c4b" />
                      </linearGradient>
                    </defs>
                  )}
                  <path d={INFINITY_PATH} stroke={front ? 'url(#cassiellos-chrome)' : undefined} />
                </svg>
              )
            })}
          </div>
          <i className={styles.symbolShadow} />
        </motion.div>

        <motion.span className={styles.heroTag} {...enter(0.15)}>
          {en ? 'Marketing agency · Belo Horizonte, Brazil' : 'Agência de marketing em Belo Horizonte'}
        </motion.span>
        <motion.h1 id="home-hero-title" className={styles.heroTitle} {...enter(0.25)}>
          {en
            ? <>Your company already works. <span>Now it needs to work better.</span></>
            : <>Sua empresa já funciona. <span>Agora ela precisa funcionar melhor.</span></>}
        </motion.h1>
        <motion.p className={styles.heroLead} {...enter(0.35)}>
          {en
            ? 'We plan, create and take care of your company’s marketing — strategy, content, campaigns, design, video and operations — to generate more opportunities and sales without everything depending on you.'
            : 'Planejamos, criamos e cuidamos do marketing da sua empresa — estratégia, conteúdo, campanhas, design, vídeos e operação — para gerar mais oportunidades e vendas sem tudo depender de você.'}
        </motion.p>
        <motion.div className={styles.heroActions} {...enter(0.45)}>
          <WhatsappCta section="hero" label={en ? 'I want to improve my marketing' : 'Quero melhorar meu marketing'} />
          <a className="btn ghost" href="#servicos">{en ? 'See what we do' : 'Ver o que fazemos'}</a>
        </motion.div>
      </div>
    </section>
  )
}
