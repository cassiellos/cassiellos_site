'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react'
import Reveal from './reveal'
import type { Locale } from './home-content'

const STEPS = [
  { number: '01', label: 'Clareza', text: 'Você sabe onde colocar energia.' },
  { number: '02', label: 'Confiança', text: 'Sua marca transmite mais valor.' },
  { number: '03', label: 'Alívio', text: 'Menos coisas dependendo de você.' },
  { number: '04', label: 'Controle', text: 'Mais visibilidade sobre o que acontece.' },
  { number: '05', label: 'Evolução real', text: 'Cada etapa deixa sua empresa mais preparada para crescer.' },
] as const

export default function Method({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const steps = en ? [
    { number: '01', label: 'Clarity', text: 'You know where to focus your energy.' },
    { number: '02', label: 'Confidence', text: 'Your brand conveys more value.' },
    { number: '03', label: 'Relief', text: 'Fewer things depend on you.' },
    { number: '04', label: 'Control', text: 'More visibility into what is happening.' },
    { number: '05', label: 'Real progress', text: 'Each stage leaves your company better prepared to grow.' },
  ] : STEPS
  const stepsRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: stepsRef,
    offset: ['start 78%', 'end 62%'],
  })
  const scaleY = useSpring(scrollYProgress, { stiffness: 110, damping: 26, restDelta: 0.001 })

  return (
    <section className="section" id="metodo">
      <div className="wrap method">
        <Reveal>
          <span className="tag">03 / {en ? 'What changes in practice' : 'O que muda na prática'}</span>
          <h2 className="h2md">{en ? 'Less weight on you. More strength for your business.' : 'Menos peso para você. Mais força para a sua empresa.'}</h2>
        </Reveal>

        <div className="steps" ref={stepsRef}>
          {!reduced && (
            <motion.i
              className="stepsTrack"
              aria-hidden
              style={{ height: '100%', scaleY }}
            />
          )}
          {steps.map((step, index) => (
            <Reveal key={step.number} className="step" delay={0.07 * index} y={18}>
              <b>{step.number}</b>
              <div>
                <strong>{step.label}</strong>
                <p>{step.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
