'use client'

import type { MouseEvent } from 'react'
import Reveal from './reveal'
import type { Locale } from './home-content'

const SERVICES = [
  {
    number: '01',
    title: 'Saiba o que fazer',
    promise: 'Clareza para tomar decisões melhores.',
    text: 'Analisamos seu negócio, identificamos o que precisa melhorar e definimos as prioridades para sua empresa avançar com mais segurança.',
    red: false,
  },
  {
    number: '02',
    title: 'Comunique melhor',
    promise: 'Uma marca mais profissional e preparada para vender.',
    text: 'Criamos conteúdos, campanhas, design e vídeos que ajudam sua empresa a ser entendida, lembrada e valorizada pelo mercado.',
    red: true,
  },
  {
    number: '03',
    title: 'Mantenha tudo funcionando',
    promise: 'Menos improviso e mais continuidade.',
    text: 'Organizamos planejamento, produção, aprovações, publicação e acompanhamento para que sua empresa avance sem depender de cobranças o tempo todo.',
    red: false,
  },
] as const

export default function Services({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  const services = en ? [
    { number: '01', title: 'Know what to do', promise: 'Clarity to make better decisions.', text: 'We analyze your business, identify what needs improvement and set the priorities so your company can move forward with greater confidence.', red: false },
    { number: '02', title: 'Communicate better', promise: 'A more professional brand, ready to sell.', text: 'We create content, campaigns, design and video that help your company be understood, remembered and valued by the market.', red: true },
    { number: '03', title: 'Keep everything running', promise: 'Less improvisation and more continuity.', text: 'We organize planning, production, approvals, publishing and monitoring so your company can move forward without constant follow-ups.', red: false },
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
            <h2>{en ? 'More clarity to grow.' : 'Mais clareza para crescer.'}</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            {en ? 'Everything connected to flow better, with fewer manual tasks and greater agility.' : 'Tudo conectado para fluir melhor, com menos tarefas manuais e mais agilidade.'}
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
              <div className="cardCopy">
                <h3>{service.title}</h3>
                <strong className="cardPromise">{service.promise}</strong>
                <p>{service.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
