'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import Reveal from './reveal'
import { useLevi } from './levi-provider'
import type { Locale } from './home-content'

const FEATURES = [
  { title: 'Entende o contexto', text: 'Conhece sua empresa, objetivo e momento atual.' },
  { title: 'Organiza os gargalos', text: 'Conecta marketing, atendimento, vendas e operação.' },
  { title: 'Sugere prioridades', text: 'Apresenta hipóteses e próximos passos em ordem.' },
  { title: 'Respeita limites', text: 'Declara pendências, fontes e nível de confiança.' },
] as const

export default function LeviSection({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const features = en ? [
    { title: 'Understands context', text: 'Learns about your company, objective and current moment.' },
    { title: 'Organizes bottlenecks', text: 'Connects marketing, service, sales and operations.' },
    { title: 'Suggests priorities', text: 'Presents hypotheses and next steps in order.' },
    { title: 'Respects limits', text: 'Declares missing data, sources and confidence.' },
  ] : FEATURES
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
          <span className="tag">05 / {en ? 'Intelligent interface' : 'Interface inteligente'}</span>
          <h2 className="leviTitle">
            LEVI <span>by CASSIELLOS</span>
          </h2>
          <p className="lead">
            {en ? 'Talk to Levi now and receive a free, no-obligation pre-diagnosis. In a few guided questions, he organizes your current situation, identifies likely bottlenecks and suggests the most useful next steps.' : 'Converse com o Levi agora e receba um pré-diagnóstico gratuito, sem compromisso. Em poucas perguntas guiadas, ele organiza seu cenário atual, identifica gargalos prováveis e sugere os próximos passos mais úteis.'}
          </p>

          <p className="leviDisclosure">
            {en ? 'Public suggestion mode, with no access to your internal systems and no external actions.' : 'Modo público de sugestão, sem acesso aos seus sistemas internos e sem executar ações externas.'}
          </p>

          <div className="features">
            {features.map((feature) => (
              <div className="feature" key={feature.title}>
                <b>{feature.title}</b>
                <span>{feature.text}</span>
              </div>
            ))}
          </div>

          <button className="btn" style={{ marginTop: 24 }} onClick={openChat}>
            {en ? 'Start free pre-diagnosis' : 'Iniciar pré-diagnóstico gratuito'}
          </button>
        </Reveal>
      </div>
    </section>
  )
}
