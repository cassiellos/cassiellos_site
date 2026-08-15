'use client'

import type { MouseEvent } from 'react'
import Reveal from './reveal'

const SERVICES = [
  {
    number: '01',
    title: 'Estratégia de Marca',
    text: 'Diagnóstico, posicionamento, identidade, campanhas, sites e landing pages.',
    red: false,
  },
  {
    number: '02',
    title: 'Conteúdo',
    text: 'Planejamento editorial, design, vídeo, captação, motion e campanhas.',
    red: true,
  },
  {
    number: '03',
    title: 'Operações',
    text: 'Calendário, aprovações, assets, publicação, automações e relatórios.',
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
    <section className="section" id="servicos">
      <div className="wrap">
        <div className="intro">
          <Reveal>
            <span className="tag">02 / Serviços</span>
            <h2>Uma agência. Três sistemas conectados.</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            Da essência da marca à rotina de publicação.
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
