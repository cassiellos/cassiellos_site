'use client'

import type { MouseEvent } from 'react'
import Reveal from './reveal'
import type { Locale } from './home-content'

const SERVICES = [
  {
    number: '01',
    title: 'Direção estratégica',
    text: 'Diagnóstico, posicionamento, identidade e decisões que organizam o crescimento da marca.',
    red: false,
  },
  {
    number: '02',
    title: 'Criação em movimento',
    text: 'Conteúdo, design, audiovisual, campanhas e experiências digitais com uma linguagem consistente.',
    red: true,
  },
  {
    number: '03',
    title: 'Operação contínua',
    text: 'Planejamento, produção, aprovação, publicação, acompanhamento e aprendizado no mesmo fluxo.',
    red: false,
  },
] as const

export default function Services({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const services = en ? [
    { number: '01', title: 'Strategic direction', text: 'Diagnosis, positioning, identity and decisions that organize brand growth.', red: false },
    { number: '02', title: 'Creative in motion', text: 'Content, design, audiovisual, campaigns and digital experiences in one consistent language.', red: true },
    { number: '03', title: 'Continuous operations', text: 'Planning, production, approval, publishing, monitoring and learning in the same flow.', red: false },
  ] : SERVICES
  // Brilho que segue o cursor dentro do cartão.
  const onMove = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`)
  }

  return (
    <section className="section paperSection" id="atuacao">
      <div className="wrap">
        <div className="intro">
          <Reveal>
            <span className="tag">02 / {en ? 'Expertise' : 'Atuação'}</span>
            <h2>{en ? 'A complete creative operation.' : 'Uma operação criativa completa.'}</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            {en ? 'Strategic thinking, production and follow-through connected by a shared method.' : 'Pensamento estratégico, produção e acompanhamento conectados por um método comum.'}
          </Reveal>
        </div>

        <div className="cards">
          {services.map((service, index) => (
            <Reveal
              key={service.number}
              as="article"
              className={service.red ? 'card red' : 'card'}
              delay={0.08 * index}
              onMouseMove={onMove}
            >
              <span className="tag">{service.number}</span>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
