'use client'

import type { MouseEvent } from 'react'
import Reveal from './reveal'

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

export default function Services() {
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
            <span className="tag">02 / Atuação</span>
            <h2>Uma operação criativa completa.</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            Pensamento estratégico, produção e acompanhamento conectados por um método comum.
          </Reveal>
        </div>

        <div className="cards">
          {SERVICES.map((service, index) => (
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
