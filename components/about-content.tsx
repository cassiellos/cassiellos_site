'use client'

import { motion, useReducedMotion } from 'motion/react'
import { displayFont } from '@/lib/display-font'
import { SHOW_PLACEHOLDERS } from '@/lib/home-proof'
import styles from './home-v3.module.css'
import about from './about-v3.module.css'
import WhatsappCta from './whatsapp-cta'
import wa from './whatsapp-cta.module.css'

type Locale = 'pt' | 'en'

const TEAM = [
  {
    name: 'Guilherme Cassim',
    initials: 'GC',
    photo: null as string | null,
    role: { pt: 'CEO e Fundador', en: 'CEO and Founder' },
    description: {
      pt: 'Estratégia, negócios, relacionamento e direção comercial.',
      en: 'Strategy, business, relationships and commercial direction.',
    },
  },
  {
    name: 'Daniel Barcellos',
    initials: 'DB',
    photo: null as string | null,
    role: { pt: 'CEO e Fundador', en: 'CEO and Founder' },
    description: {
      pt: 'Marketing, planejamento, operação e relacionamento com clientes.',
      en: 'Marketing, planning, operations and client relationships.',
    },
  },
]

const COPY = {
  pt: {
    hero: {
      eyebrow: 'Cassiellos · A Empresa',
      title: 'Clareza em movimento.',
      body: 'Somos uma empresa mineira de operações criativas, construída por pessoas que trabalham entre estratégia, comunicação, design e audiovisual. Gostamos de entender os negócios com que nos envolvemos, construir relações próximas e fazer o trabalho evoluir com consistência.',
      meta: ['Belo Horizonte / MG', 'Criatividade', 'Proximidade', 'Consistência'],
      primary: 'Falar com a Cassiellos',
      secondary: 'Conhecer o time',
      wa: { identity: 'Quero trabalhar com a Cassiellos', culture: 'Falar com o time', people: 'Conversar com os fundadores', principles: 'Começar uma conversa', future: 'Fazer parte do próximo capítulo' },
    },
    identity: {
      eyebrow: 'Quem somos',
      title: 'Quem somos aparece no jeito como trabalhamos.',
      paragraphs: [
        'Gostamos de conhecer o negócio antes de propor caminhos. Entender as pessoas, a realidade da empresa e o que está acontecendo ao redor faz parte do nosso trabalho.',
        'Para nós, criatividade também significa dar direção às ideias, assumir responsabilidade pelo que colocamos no mundo e continuar melhorando depois da primeira entrega.',
        '“Clareza em movimento” resume essa visão: entender bem, decidir com intenção e transformar pensamento em ação.',
      ],
      flow: ['Curiosidade', 'Clareza', 'Responsabilidade', 'Evolução'],
    },
    culture: {
      eyebrow: 'Por dentro',
      title: 'O jeito como fazemos importa tanto quanto o que entregamos.',
      support: 'Queremos crescer sem perder aquilo que torna o trabalho bom de verdade: proximidade, responsabilidade e vontade de fazer melhor.',
      items: [
        ['Proximidade', 'Trabalhamos melhor quando conhecemos as pessoas, o negócio e a realidade por trás de cada decisão.'],
        ['Criatividade com disciplina', 'Ideias ganham força quando existe direção, cuidado, repertório e capacidade de executar bem.'],
        ['Transparência', 'Preferimos conversas claras, expectativas compreensíveis e relações em que as pessoas sabem onde estão.'],
      ],
    },
    people: {
      eyebrow: 'Time',
      title: 'O time que constrói a Cassiellos.',
      body: 'Nosso time reúne estratégia, negócios, marketing e design na construção da empresa e na condução do trabalho.',
      photo: 'Foto profissional (retrato, fundo neutro).',
      placeholder: 'A preencher',
    },
    principles: {
      eyebrow: 'Nosso código',
      title: 'O que queremos continuar sendo, mesmo enquanto crescemos.',
      items: [
        ['Clareza', 'Entender, explicar e decidir de um jeito que as pessoas consigam acompanhar.'],
        ['Continuidade', 'Construir relações, marcas e trabalhos que evoluem com o tempo.'],
        ['Criatividade com disciplina', 'Dar espaço para boas ideias e estrutura suficiente para fazê-las acontecer.'],
        ['Proximidade', 'Conhecer as pessoas e os negócios com que escolhemos trabalhar.'],
        ['Transparência', 'Tratar expectativas, decisões, responsabilidades e resultados com clareza.'],
      ],
    },
    future: {
      eyebrow: 'Próximo capítulo',
      title: 'Ainda estamos construindo.',
      body: 'A Cassiellos continua evoluindo. Nossa ambição é aproximar criatividade, estratégia e operação cada vez mais, sem perder a proximidade e o cuidado que existem quando pessoas boas trabalham juntas em um problema real.',
    },
    final: { title: 'Talvez o próximo movimento possa ser', brand: 'junto.', button: 'Fale com a gente' },
  },
  en: {
    hero: {
      eyebrow: 'Cassiellos · Company',
      title: 'Clarity in motion.',
      body: 'We are a creative operations company from Minas Gerais, built by people working across strategy, communication, design and audiovisual. We like to understand the businesses we get involved with, build close relationships and help the work evolve consistently.',
      meta: ['Belo Horizonte / MG', 'Creativity', 'Proximity', 'Consistency'],
      primary: 'Talk to Cassiellos',
      secondary: 'Meet the team',
      wa: { identity: 'I want to work with Cassiellos', culture: 'Talk to the team', people: 'Talk to the founders', principles: 'Start a conversation', future: 'Be part of the next chapter' },
    },
    identity: {
      eyebrow: 'Who we are',
      title: 'Who we are shows in the way we work.',
      paragraphs: [
        'We like to understand the business before proposing a direction. Knowing the people, the company’s reality and what is happening around it is part of the work.',
        'For us, creativity also means giving ideas direction, taking responsibility for what we put into the world and continuing to improve after the first delivery.',
        '“Clarity in motion” sums up that view: understand well, decide with intention and turn thinking into action.',
      ],
      flow: ['Curiosity', 'Clarity', 'Responsibility', 'Evolution'],
    },
    culture: {
      eyebrow: 'From the inside',
      title: 'How we do things matters as much as what we deliver.',
      support: 'We want to grow without losing what makes good work genuinely good: proximity, responsibility and the desire to keep improving.',
      items: [
        ['Proximity', 'We work better when we know the people, the business and the reality behind each decision.'],
        ['Creativity with discipline', 'Ideas become stronger with direction, care, repertoire and the ability to execute well.'],
        ['Transparency', 'We prefer clear conversations, understandable expectations and relationships where people know where they stand.'],
      ],
    },
    people: {
      eyebrow: 'Team',
      title: 'The team building Cassiellos.',
      body: 'Our team brings strategy, business, marketing and design together in building the company and guiding the work.',
      photo: 'Professional portrait (neutral background).',
      placeholder: 'To be filled',
    },
    principles: {
      eyebrow: 'Our code',
      title: 'What we want to remain as we grow.',
      items: [
        ['Clarity', 'Understand, explain and decide in ways people can follow.'],
        ['Continuity', 'Build relationships, brands and work that evolve over time.'],
        ['Creativity with discipline', 'Give good ideas room and enough structure to make them happen.'],
        ['Proximity', 'Know the people and businesses we choose to work with.'],
        ['Transparency', 'Treat expectations, decisions, responsibilities and results with clarity.'],
      ],
    },
    future: {
      eyebrow: 'Next chapter',
      title: 'We are still building.',
      body: 'Cassiellos keeps evolving. Our ambition is to bring creativity, strategy and operations closer together without losing the proximity and care that exist when good people work together on a real problem.',
    },
    final: { title: 'Maybe the next move can be', brand: 'together.', button: 'Talk to us' },
  },
} as const

const EASE = [0.22, 1, 0.36, 1] as const

export default function AboutContent({ lang }: { lang: Locale }) {
  const c = COPY[lang]
  const reduced = useReducedMotion()
  const reveal = (delay = 0, y = 22) => reduced ? {} : {
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: 0.64, delay, ease: EASE },
  }
  const enter = (delay: number) => reduced ? {} : {
    initial: { opacity: 0, y: 26 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay, ease: EASE },
  }

  return (
    <main id="top" className={`${styles.page} ${displayFont.variable}`}>
      <section className={`${styles.hero} ${about.hero}`} aria-labelledby="about-hero-title">
        <div className={styles.room} aria-hidden="true">
          <i className={styles.roomCeiling} />
          <i className={styles.roomFloor} />
          <i className={styles.roomGlow} />
        </div>
        <div className={`wrap ${styles.heroInner}`}>
          <motion.span className={styles.heroTag} {...enter(0.1)}>{c.hero.eyebrow}</motion.span>
          <motion.h1 id="about-hero-title" className={styles.heroTitle} {...enter(0.2)}>{c.hero.title}</motion.h1>
          <motion.p className={styles.heroLead} {...enter(0.3)}>{c.hero.body}</motion.p>
          <motion.ul className={about.chips} {...enter(0.38)}>
            {c.hero.meta.map((item) => <li key={item}>{item}</li>)}
          </motion.ul>
          <motion.div className={styles.heroActions} {...enter(0.45)}>
            <WhatsappCta section="empresa-hero" label={c.hero.primary} />
            <a className="btn ghost" href="#time">{c.hero.secondary}</a>
          </motion.div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="about-identity-title">
        <div className="wrap">
          <div className={styles.sectionHead}>
            <motion.div {...reveal()}>
              <span className={styles.eyebrow}>{c.identity.eyebrow}</span>
              <h2 id="about-identity-title" className={styles.display}>{c.identity.title}</h2>
            </motion.div>
            <motion.div className={`${styles.headAside} ${about.stack}`} {...reveal(0.08)}>
              {c.identity.paragraphs.map((text) => <p key={text}>{text}</p>)}
            </motion.div>
          </div>
          <div className={wa.row}><WhatsappCta section="empresa-quem-somos" label={c.hero.wa.identity} /></div>
        </div>
      </section>

      <div className={styles.ticker} aria-hidden="true">
        <div className={`${styles.tickerTrack} ${reduced ? styles.marqueeStill : ''}`}>
          {[...c.identity.flow, ...c.identity.flow, ...c.identity.flow, ...c.identity.flow].map((item, index) => (
            <span key={`${item}-${index}`}>{item}<i>∞</i></span>
          ))}
        </div>
      </div>

      <section className={`${styles.section} ${styles.servicesV3}`} aria-labelledby="about-culture-title">
        <div className="wrap">
          <div className={styles.sectionHead}>
            <motion.div {...reveal()}>
              <span className={styles.eyebrow}>{c.culture.eyebrow}</span>
              <h2 id="about-culture-title" className={styles.display}>{c.culture.title}</h2>
            </motion.div>
            <motion.div className={styles.headAside} {...reveal(0.08)}><p>{c.culture.support}</p></motion.div>
          </div>
          <div className={styles.serviceCards}>
            {c.culture.items.map(([title, text], index) => (
              <motion.article key={title} className={styles.serviceCard} {...reveal(index * 0.06, 18)}>
                <span className={styles.serviceNumber}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
          <div className={wa.row}><WhatsappCta section="empresa-cultura" label={c.hero.wa.culture} variant="ghost" /></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.results}`} id="time" aria-labelledby="about-people-title">
        <div className="wrap">
          <div className={styles.sectionHead}>
            <motion.div {...reveal()}>
              <span className={styles.eyebrow}>{c.people.eyebrow}</span>
              <h2 id="about-people-title" className={styles.display}>{c.people.title}</h2>
            </motion.div>
            <motion.div className={styles.headAside} {...reveal(0.08)}><p>{c.people.body}</p></motion.div>
          </div>
          <div className={about.team}>
            {TEAM.map((person, index) => (
              <motion.article className={about.person} key={person.name} {...reveal(index * 0.06, 18)}>
                <div className={about.portrait}>
                  {person.photo
                    ? <img src={person.photo} alt={person.name} loading="lazy" />
                    : <span aria-hidden="true">{person.initials}</span>}
                  {!person.photo && SHOW_PLACEHOLDERS && (
                    <small className={about.photoTodo}>{c.people.placeholder}: {c.people.photo}</small>
                  )}
                </div>
                <div className={about.personCopy}>
                  <h3>{person.name}</h3>
                  <strong>{person.role[lang]}</strong>
                  <p>{person.description[lang]}</p>
                </div>
              </motion.article>
            ))}
          </div>
          <div className={wa.row}><WhatsappCta section="empresa-time" label={c.hero.wa.people} /></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.approach}`} aria-labelledby="about-principles-title">
        <div className="wrap">
          <motion.div className={styles.sectionHeadSolo} {...reveal()}>
            <span className={styles.eyebrow}>{c.principles.eyebrow}</span>
            <h2 id="about-principles-title" className={styles.display}>{c.principles.title}</h2>
          </motion.div>
          <div className={about.principles}>
            {c.principles.items.map(([title, text], index) => (
              <motion.article key={title} className={styles.serviceCard} {...reveal(index * 0.05, 18)}>
                <span className={styles.serviceNumber}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
          <div className={wa.row}><WhatsappCta section="empresa-principios" label={c.hero.wa.principles} variant="ghost" /></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.faqV3}`} aria-labelledby="about-future-title">
        <motion.div className={`wrap ${styles.centerHead} ${about.future}`} {...reveal()}>
          <span className={styles.eyebrow}>{c.future.eyebrow}</span>
          <h2 id="about-future-title" className={styles.display}>{c.future.title}</h2>
          <p>{c.future.body}</p>
          <div className={wa.row}><WhatsappCta section="empresa-futuro" label={c.hero.wa.future} /></div>
        </motion.div>
      </section>

      <section className={styles.finalCta} aria-labelledby="about-final-title">
        <div className={`wrap ${styles.finalInner}`}>
          <h2 id="about-final-title" className={styles.display}>{c.final.title} <span>{c.final.brand}</span></h2>
          <WhatsappCta section="empresa-chamada-final" label={c.final.button} />
        </div>
      </section>
    </main>
  )
}
