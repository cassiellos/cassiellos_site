'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import Reveal from './reveal'
import { useLevi } from './levi-provider'

const FEATURES = [
  { title: 'Explica', text: 'Serviços, método e posicionamento.' },
  { title: 'Navega', text: 'Leva o visitante ao ponto certo.' },
  { title: 'Contextualiza', text: 'Conecta Cassiellos e cassiellOS.' },
  { title: 'Respeita limites', text: 'Não inventa execução ou acesso.' },
] as const

export default function LeviSection() {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const { openChat } = useLevi()

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 110, damping: 30, restDelta: 0.001 })
  const orbY = useTransform(smooth, [0, 1], ['12%', '-12%'])

  return (
    <section className="section leviSec" id="levi" ref={ref}>
      <div className="wrap levi">
        <motion.div className="leviOrb" style={reduced ? undefined : { y: orbY }}>
          <i className="ring r1" />
          <i className="ring r2" />
          <i className="core" />
        </motion.div>

        <Reveal>
          <span className="tag">05 / Interface inteligente</span>
          <h2 className="leviTitle">
            LEVI <span>by CASSIELLOS</span>
          </h2>
          <p className="lead">
            Levi aproxima pessoas, contexto e operação. No site, ele responde dúvidas, orienta a
            navegação e apresenta o ecossistema Cassiellos com clareza.
          </p>

          <div className="features">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.title}>
                <b>{feature.title}</b>
                <span>{feature.text}</span>
              </div>
            ))}
          </div>

          <button className="btn" style={{ marginTop: 24 }} onClick={openChat}>
            Conversar com o Levi
          </button>
        </Reveal>
      </div>
    </section>
  )
}
