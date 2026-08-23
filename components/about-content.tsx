'use client'

import { motion, useReducedMotion } from 'motion/react'
import InfinityMark from './infinity-mark'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './about-content.module.css'

type Locale = 'pt' | 'en'

const TEAM = [
  {
    name: 'Guilherme Cassim',
    role: { pt: 'Co-Founder & Co-CEO', en: 'Co-Founder & Co-CEO' },
    description: {
      pt: 'Estratégia, negócios, relacionamento e direção comercial.',
      en: 'Strategy, business, relationships and commercial direction.',
    },
  },
  {
    name: 'Daniel Barcellos',
    role: { pt: 'Co-Founder & Co-CEO', en: 'Co-Founder & Co-CEO' },
    description: {
      pt: 'Marketing, planejamento, operação e relacionamento com clientes.',
      en: 'Marketing, planning, operations and client relationships.',
    },
  },
  {
    name: 'Rafael Torres',
    role: { pt: 'Head of Design & Product', en: 'Head of Design & Product' },
    description: {
      pt: 'Branding, design, produtos digitais e tecnologia criativa.',
      en: 'Branding, design, digital products and creative technology.',
    },
  },
] as const

const COPY = {
  pt: {
    hero: {
      eyebrow: 'Cassiellos / A Empresa',
      title: 'Clareza em movimento.',
      body: 'Somos uma empresa mineira de operações criativas, construída por pessoas que trabalham entre estratégia, comunicação, design, audiovisual e tecnologia. Gostamos de entender os negócios com que nos envolvemos, construir relações próximas e fazer o trabalho evoluir com consistência.',
      meta: ['Belo Horizonte / MG', 'Criatividade', 'Proximidade', 'Tecnologia'],
    },
    identity: {
      title: 'Quem somos aparece no jeito como trabalhamos.',
      paragraphs: [
        'Gostamos de conhecer o negócio antes de propor caminhos. Entender as pessoas, a realidade da empresa e o que está acontecendo ao redor faz parte do nosso trabalho.',
        'Para nós, criatividade também significa dar direção às ideias, assumir responsabilidade pelo que colocamos no mundo e continuar melhorando depois da primeira entrega.',
        '“Clareza em movimento” resume essa visão: entender bem, decidir com intenção e transformar pensamento em ação.',
      ],
      flow: ['Curiosidade', 'Clareza', 'Responsabilidade', 'Evolução ↻'],
    },
    culture: {
      eyebrow: 'Cassiellos / Por dentro',
      title: 'O jeito como fazemos importa tanto quanto o que entregamos.',
      support: 'Queremos crescer sem perder aquilo que torna o trabalho bom de verdade: proximidade, responsabilidade e vontade de fazer melhor.',
      close: 'A forma como uma empresa trabalha também é parte do que ela entrega.',
      items: [
        ['Proximidade', 'Trabalhamos melhor quando conhecemos as pessoas, o negócio e a realidade por trás de cada decisão.'],
        ['Criatividade com disciplina', 'Ideias ganham força quando existe direção, cuidado, repertório e capacidade de executar bem.'],
        ['Transparência', 'Preferimos conversas claras, expectativas compreensíveis e relações em que as pessoas sabem onde estão.'],
      ],
    },
    people: {
      eyebrow: 'Time',
      title: 'O time que constrói a Cassiellos.',
      body: 'Nosso time reúne estratégia, negócios, marketing, design, produto e tecnologia na construção da empresa e na condução do trabalho.',
    },
    tech: {
      eyebrow: 'Cassiellos / Tecnologia com propósito',
      title: ['Quando as ferramentas não acompanham,', 'começamos a construir as nossas.'],
      body: 'Tecnologia faz parte de quem somos porque gostamos de organizar, conectar e melhorar o trabalho que acontece todos os dias.',
      body2: 'O cassiellOS reúne a operação da Cassiellos em um mesmo ambiente. Levi é a interface inteligente que ajuda pessoas a encontrar informações, entender o que está acontecendo e conversar com o sistema de forma mais simples.',
      close: 'Construímos tecnologia para apoiar pessoas e manter pessoas no centro das decisões.',
      osLabel: 'Tecnologia criada dentro da Cassiellos',
      osName: 'cassiellOS',
      osDesc: 'Organiza tarefas, materiais, histórico e acompanhamento para que o trabalho continue conectado.',
      leviLabel: 'Assistente da Cassiellos',
      leviName: 'Levi',
      leviDesc: 'Ajuda a acessar informações, orientação e contexto com mais naturalidade.',
      nodes: ['Organização', 'Materiais', 'Histórico', 'Acompanhamento'],
    },
    principles: {
      eyebrow: 'Nosso código',
      title: 'O que queremos continuar sendo, mesmo enquanto crescemos.',
      body: 'Esses princípios orientam a forma como nos relacionamos, decidimos e construímos.',
      items: [
        ['Clareza', 'Entender, explicar e decidir de um jeito que as pessoas consigam acompanhar.'],
        ['Continuidade', 'Construir relações, marcas e trabalhos que evoluem com o tempo.'],
        ['Criatividade com disciplina', 'Dar espaço para boas ideias e estrutura suficiente para fazê-las acontecer.'],
        ['Proximidade', 'Conhecer as pessoas e os negócios com que escolhemos trabalhar.'],
        ['Tecnologia com propósito', 'Criar ferramentas quando elas tornam o trabalho mais simples, conectado e útil.'],
        ['Transparência', 'Tratar expectativas, decisões, responsabilidades e resultados com clareza.'],
      ],
    },
    future: {
      eyebrow: 'Próximo capítulo',
      title: 'Ainda estamos construindo.',
      paragraphs: [
        'A Cassiellos continua evoluindo. Nossa ambição é aproximar criatividade, estratégia, operação e tecnologia cada vez mais, sem perder a proximidade e o cuidado que existem quando pessoas boas trabalham juntas em um problema real.',
        'Queremos que novas capacidades, produtos e pessoas ampliem o que conseguimos construir, enquanto a essência da empresa continua reconhecível em cada novo movimento.',
      ],
    },
    cta: {
      eyebrow: 'Próximo movimento',
      title: ['Talvez o próximo', 'movimento possa ser junto.'],
      body: 'Se você se identifica com a forma como pensamos e quer conversar sobre o momento da sua empresa, estamos por aqui.',
      button: 'Falar com a Cassiellos',
    },
  },
  en: {
    hero: {
      eyebrow: 'Cassiellos / Company',
      title: 'Clarity in motion.',
      body: 'We are a creative operations company from Minas Gerais, built by people working across strategy, communication, design, audiovisual and technology. We like to understand the businesses we get involved with, build close relationships and help the work evolve consistently.',
      meta: ['Belo Horizonte / MG', 'Creativity', 'Proximity', 'Technology'],
    },
    identity: {
      title: 'Who we are shows in the way we work.',
      paragraphs: [
        'We like to understand the business before proposing a direction. Knowing the people, the company’s reality and what is happening around it is part of the work.',
        'For us, creativity also means giving ideas direction, taking responsibility for what we put into the world and continuing to improve after the first delivery.',
        '“Clarity in motion” sums up that view: understand well, decide with intention and turn thinking into action.',
      ],
      flow: ['Curiosity', 'Clarity', 'Responsibility', 'Evolution ↻'],
    },
    culture: {
      eyebrow: 'Cassiellos / From the inside',
      title: 'How we do things matters as much as what we deliver.',
      support: 'We want to grow without losing what makes good work genuinely good: proximity, responsibility and the desire to keep improving.',
      close: 'The way a company works is also part of what it delivers.',
      items: [
        ['Proximity', 'We work better when we know the people, the business and the reality behind each decision.'],
        ['Creativity with discipline', 'Ideas become stronger with direction, care, repertoire and the ability to execute well.'],
        ['Transparency', 'We prefer clear conversations, understandable expectations and relationships where people know where they stand.'],
      ],
    },
    people: {
      eyebrow: 'Team',
      title: 'The team building Cassiellos.',
      body: 'Our team brings strategy, business, marketing, design, product and technology together in building the company and guiding the work.',
    },
    tech: {
      eyebrow: 'Cassiellos / Technology with purpose',
      title: ['When tools cannot keep up,', 'we start building our own.'],
      body: 'Technology is part of who we are because we like to organize, connect and improve the work that happens every day.',
      body2: 'cassiellOS brings Cassiellos operations into one environment. Levi is the intelligent interface that helps people find information, understand what is happening and interact with the system more naturally.',
      close: 'We build technology to support people and keep people at the center of decisions.',
      osLabel: 'Technology created inside Cassiellos',
      osName: 'cassiellOS',
      osDesc: 'Organizes tasks, materials, history and follow-through so work stays connected.',
      leviLabel: 'Cassiellos assistant',
      leviName: 'Levi',
      leviDesc: 'Helps people access information, guidance and context more naturally.',
      nodes: ['Organization', 'Materials', 'History', 'Follow-through'],
    },
    principles: {
      eyebrow: 'Our code',
      title: 'What we want to remain as we grow.',
      body: 'These principles guide how we relate, decide and build.',
      items: [
        ['Clarity', 'Understand, explain and decide in ways people can follow.'],
        ['Continuity', 'Build relationships, brands and work that evolve over time.'],
        ['Creativity with discipline', 'Give good ideas room and enough structure to make them happen.'],
        ['Proximity', 'Know the people and businesses we choose to work with.'],
        ['Technology with purpose', 'Build tools when they make work simpler, more connected and more useful.'],
        ['Transparency', 'Treat expectations, decisions, responsibilities and results with clarity.'],
      ],
    },
    future: {
      eyebrow: 'Next chapter',
      title: 'We are still building.',
      paragraphs: [
        'Cassiellos keeps evolving. Our ambition is to bring creativity, strategy, operations and technology closer together without losing the proximity and care that exist when good people work together on a real problem.',
        'We want new capabilities, products and people to expand what we can build while the essence of the company remains recognizable in every new move.',
      ],
    },
    cta: {
      eyebrow: 'Next move',
      title: ['Maybe the next', 'move can be together.'],
      body: 'If you identify with the way we think and want to talk about your company, we are here.',
      button: 'Talk to Cassiellos',
    },
  },
} as const

const EASE = [0.22, 1, 0.36, 1] as const

export default function AboutContent({ lang }: { lang: Locale }) {
  const c = COPY[lang]
  const reduced = useReducedMotion()
  const reveal = (delay = 0, y = 22) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.2 },
          transition: { duration: 0.64, delay, ease: EASE },
        }

  return (
    <main id="top" className={styles.page}>
      <section className={styles.hero} aria-labelledby="about-hero-title">
        <div className={styles.heroMesh} aria-hidden />
        <div className={`wrap ${styles.heroGrid}`}>
          <motion.div className={styles.heroCopy} {...reveal(0)}>
            <span className={`tag ${styles.eyebrow}`}>{c.hero.eyebrow}</span>
            <h1 id="about-hero-title" className={styles.display}>{c.hero.title}</h1>
            <p>{c.hero.body}</p>
            <div className={styles.heroMeta} aria-label={lang === 'pt' ? 'Origem e características da Cassiellos' : 'Cassiellos origin and characteristics'}>
              {c.hero.meta.map((item) => <span key={item}>{item}</span>)}
            </div>
          </motion.div>

          <motion.div className={styles.brandMotion} {...reveal(0.08, 0)} aria-hidden>
            <i className={`${styles.brandRing} ${styles.ringOne}`} />
            <i className={`${styles.brandRing} ${styles.ringTwo}`} />
            <i className={`${styles.brandRing} ${styles.ringThree}`} />
            <InfinityMark className={styles.heroSymbol} />
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} aria-labelledby="about-identity-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.thesisIntro}>
            <motion.h2 id="about-identity-title" className={`${styles.display} ${styles.sectionTitle}`} {...reveal(0)}>
              {c.identity.title}
            </motion.h2>
            <motion.div className={styles.thesisCopy} {...reveal(0.08)}>
              {c.identity.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </motion.div>
          </div>

          <div className={styles.editorialFlow} aria-label={lang === 'pt' ? 'Traços da forma de pensar da Cassiellos' : 'Traits of the Cassiellos mindset'}>
            {c.identity.flow.map((step, index) => (
              <motion.div className={styles.flowStep} key={step} {...reveal(index * 0.06, 14)}>
                <span className={styles.flowIndex}>{String(index + 1).padStart(2, '0')}</span>
                <i className={styles.flowNode} aria-hidden />
                <strong>{step}</strong>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.navy}`} aria-labelledby="about-culture-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.capabilitiesHeader}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.culture.eyebrow}</span>
              <h2 id="about-culture-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.culture.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.culture.support}</motion.p>
          </div>

          <div className={styles.capabilities}>
            {c.culture.items.map(([title, description], index) => (
              <motion.article className={styles.capability} key={title} {...reveal(index * 0.06, 18)}>
                <span className={styles.capabilityIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3 className={styles.display}>{title}</h3>
                <p>{description}</p>
              </motion.article>
            ))}
          </div>
          <motion.p className={styles.capabilityClose} {...reveal(0.1)}>{c.culture.close}</motion.p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} aria-labelledby="about-people-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.peopleIntro}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.people.eyebrow}</span>
              <h2 id="about-people-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.people.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.people.body}</motion.p>
          </div>

          <div className={styles.peopleGrid}>
            {TEAM.map((person, index) => (
              <motion.article className={styles.person} key={person.name} {...reveal(index * 0.06, 18)}>
                <div className={styles.personCopy}>
                  <span className={styles.capabilityIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <h3 className={styles.display}>{person.name}</h3>
                  <p>
                    <strong>{person.role[lang]}</strong>
                    <span>{person.description[lang]}</span>
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.deep}`} aria-labelledby="about-tech-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.techIntro}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.tech.eyebrow}</span>
              <h2 id="about-tech-title" className={styles.display}>
                <span>{c.tech.title[0]}</span><br />
                <span>{c.tech.title[1]}</span>
              </h2>
            </motion.div>
            <motion.div {...reveal(0.08)}>
              <p>{c.tech.body}</p>
              <p>{c.tech.body2}</p>
              <strong>{c.tech.close}</strong>
            </motion.div>
          </div>

          <motion.div className={styles.systemCanvas} {...reveal(0.08, 18)}>
            <div className={styles.systemLayer}>
              <span className={styles.systemLabel}>{c.tech.osLabel}</span>
              <strong className={styles.systemName}>{c.tech.osName}</strong>
              <p className={styles.systemDesc}>{c.tech.osDesc}</p>
              <div className={styles.systemNodes}>
                {c.tech.nodes.map((node) => <span key={node}>{node}</span>)}
              </div>
            </div>
            <div className={styles.leviLayer}>
              <div className={styles.leviCopy}>
                <span className={styles.leviLabel}>{c.tech.leviLabel}</span>
                <h3 className={styles.display}>{c.tech.leviName}</h3>
                <p>{c.tech.leviDesc}</p>
              </div>
              <div className={styles.leviOrb} aria-hidden>
                <i className={`${styles.leviRing} ${styles.leviRingOne}`} />
                <i className={`${styles.leviRing} ${styles.leviRingTwo}`} />
                <i className={styles.leviCore} />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.navy}`} aria-labelledby="about-principles-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.principlesIntro}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.principles.eyebrow}</span>
              <h2 id="about-principles-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.principles.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.principles.body}</motion.p>
          </div>

          <div className={styles.principlesGrid}>
            {c.principles.items.map(([title, description], index) => (
              <motion.article className={styles.principle} key={title} {...reveal(index * 0.04, 14)}>
                <span className={styles.principleIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3 className={styles.display}>{title}</h3>
                <p>{description}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} aria-labelledby="about-future-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.thesisIntro}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.future.eyebrow}</span>
              <h2 id="about-future-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.future.title}</h2>
            </motion.div>
            <motion.div className={styles.thesisCopy} {...reveal(0.08)}>
              {c.future.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </motion.div>
          </div>
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="about-cta-title">
        <div className="wrap">
          <motion.div {...reveal(0)}>
            <span className={`tag ${styles.eyebrow}`}>{c.cta.eyebrow}</span>
            <h2 id="about-cta-title" className={styles.display}>
              {c.cta.title.map((line) => <span key={line}>{line}</span>)}
            </h2>
            <p>{c.cta.body}</p>
            <a className={`btn ${styles.ctaButton}`} href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
              {c.cta.button}
            </a>
          </motion.div>
        </div>
      </section>
    </main>
  )
}
