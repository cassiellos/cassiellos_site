'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react'
import Reveal from './reveal'

const STEPS = [
  { number: '01', label: 'Diagnóstico' },
  { number: '02', label: 'Direção' },
  { number: '03', label: 'Produção' },
  { number: '04', label: 'Aprovação e publicação' },
  { number: '05', label: 'Aprendizado' },
] as const

export default function Method() {
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
          <span className="tag">03 / Método Cassiellos</span>
          <h2 className="h2md">O contexto acompanha o trabalho até o próximo ciclo.</h2>
        </Reveal>

        <div className="steps" ref={stepsRef}>
          {!reduced && (
            <motion.i
              className="stepsTrack"
              aria-hidden
              style={{ height: '100%', scaleY }}
            />
          )}
          {STEPS.map((step, index) => (
            <Reveal key={step.number} className="step" delay={0.07 * index} y={18}>
              <b>{step.number}</b>
              {step.label}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
