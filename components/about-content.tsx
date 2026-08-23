'use client'

import { motion, useReducedMotion } from 'motion/react'
import InfinityMark from './infinity-mark'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './about-content.module.css'

type Locale = 'pt' | 'en'

const TEAM = [
  { name: 'Guilherme Cassim', role: { pt: 'CEO & Gerente de Marketing', en: 'CEO & Marketing Manager' } },
  { name: 'Daniel Barcellos', role: { pt: 'CEO & Gerente de Marketing', en: 'CEO & Marketing Manager' } },
  { name: 'Rafael Torres', role: { pt: 'Head Designer', en: 'Head Designer' } },
] as const

const COPY = {
  pt: {
    hero: {
      eyebrow: 'Cassiellos / Sobre',
      title: 'Clareza em movimento.',
      body: 'A Cassiellos é uma empresa de operações criativas. Reunimos estratégia, criação, tecnologia e acompanhamento em um sistema contínuo para fazer boas ideias avançarem com contexto, qualidade e ritmo.',
      meta: ['Belo Horizonte / MG', 'Estratégia', 'Conteúdo', 'Operações'],
      motionCaption: 'Motion oficial / órbita institucional',
    },
    thesis: {
      title: 'Boas ideias precisam de um sistema para avançar.',
      paragraphs: [
        'Marketing envolve decisões, pessoas, arquivos, versões, prazos, aprovações, canais e aprendizado. Quando esse contexto se perde entre ferramentas e demandas isoladas, a criatividade também perde ritmo.',
        'A Cassiellos cresceu reunindo capacidades que antes apareciam separadas. Estratégia, design, conteúdo, audiovisual, tecnologia e operação passaram a compartilhar o mesmo contexto.',
        'É dessa integração que nasce nossa forma de trabalhar.',
      ],
      flow: ['Estratégia', 'Criação', 'Operação', 'Aprendizado ↻'],
    },
    capability: {
      eyebrow: 'Cassiellos / Operação',
      title: 'Planejamos, criamos e operamos.',
      support: 'A sequência muda conforme o projeto. A leitura do contexto permanece conectada.',
      close: 'Cada projeto pede uma sequência diferente. O contexto permanece conectado.',
      items: [
        ['Direção', 'Entender o negócio, organizar prioridades e definir o que precisa avançar.'],
        ['Expressão', 'Transformar estratégia em identidade, conteúdo, design, audiovisual e experiências.'],
        ['Operação', 'Conectar planejamento, produção, aprovação, publicação, acompanhamento e aprendizado.'],
      ],
    },
    tech: {
      eyebrow: 'Cassiellos / Sistema operacional',
      title: ['Tecnologia nos bastidores.', 'Contexto na frente.'],
      body: 'Construímos nossa própria infraestrutura operacional para conectar clientes, planejamentos, tarefas, arquivos, aprovações, histórico e automações.',
      body2: 'O cassiellOS ajuda a preservar contexto e tornar o trabalho visível. Levi aproxima pessoas e sistema por conversa, orientação e ações controladas.',
      close: 'A tecnologia entra onde reduz fricção. O julgamento, a direção e a criação continuam humanos.',
      osLabel: 'Infraestrutura operacional',
      osName: 'cassiellOS',
      osDesc: 'Organiza o estado da operação sem competir com a marca principal.',
      leviLabel: 'Interface inteligente',
      leviName: 'Levi',
      leviDesc: 'Aproxima pessoas e sistema por contexto, orientação e ações controladas.',
      nodes: ['Clientes', 'Planejamentos', 'Tarefas', 'Arquivos', 'Aprovações', 'Histórico'],
    },
    process: {
      eyebrow: 'Processo visível',
      title: 'Processo visível. Trabalho real.',
      body: 'A direção de imagem da Cassiellos prioriza gesto, concentração, colaboração, profundidade e situações reais de trabalho.',
      line: 'Planejamento / direção / design / audiovisual / tecnologia / acompanhamento',
      placeholder: 'Slot para imagem real',
      slots: ['Planejamento', 'Captação', 'Criação', 'Revisão', 'Tecnologia em uso', 'Bastidores'],
    },
    people: {
      eyebrow: 'Pessoas',
      title: 'Pessoas que mantêm o movimento.',
      body: 'A liderança aparece com presença editorial. Os retratos oficiais entram aqui quando estiverem disponíveis no projeto.',
      placeholder: 'Retrato oficial 3:4',
      pending: 'Foto oficial pendente',
    },
    principles: {
      eyebrow: 'Princípios operacionais',
      title: 'O que precisa continuar verdadeiro enquanto crescemos.',
      body: 'Os valores da marca aparecem como critérios de operação, decisão e relacionamento.',
      items: [
        ['Clareza', 'Objetivos, responsáveis, etapas, decisões e próximos passos compreensíveis.'],
        ['Continuidade', 'Marcas fortes são construídas por repetição coerente, acompanhamento e evolução.'],
        ['Criatividade com disciplina', 'Ideias fortes precisam de direção, processo e capacidade de execução.'],
        ['Proximidade', 'Conhecer o cliente, sua operação e seu contexto faz parte da entrega.'],
        ['Tecnologia com propósito', 'Reduzir fricção, preservar contexto e automatizar o repetível.'],
        ['Transparência', 'Tornar status, responsabilidades, decisões e resultados visíveis e rastreáveis.'],
      ],
    },
    cta: {
      eyebrow: 'Próximo movimento',
      title: ['Clareza para decidir.', 'Ritmo para executar.', 'Consistência para crescer.'],
      body: 'Conte o momento da sua empresa. A primeira conversa começa pelo contexto.',
      button: 'Agendar diagnóstico',
    },
  },
  en: {
    hero: {
      eyebrow: 'Cassiellos / About',
      title: 'Clarity in motion.',
      body: 'Cassiellos is a creative operations company. We connect strategy, creative, technology and follow-through in a continuous system that helps strong ideas move forward with context, quality and rhythm.',
      meta: ['Belo Horizonte / MG', 'Strategy', 'Content', 'Operations'],
      motionCaption: 'Official motion / institutional orbit',
    },
    thesis: {
      title: 'Good ideas need a system to move forward.',
      paragraphs: [
        'Marketing involves decisions, people, files, versions, deadlines, approvals, channels and learning. When that context gets lost between tools and isolated requests, creativity loses momentum too.',
        'Cassiellos grew by bringing together capabilities that used to appear separately. Strategy, design, content, audiovisual, technology and operations now share the same context.',
        'That integration shapes the way we work.',
      ],
      flow: ['Strategy', 'Creative', 'Operations', 'Learning ↻'],
    },
    capability: {
      eyebrow: 'Cassiellos / Operations',
      title: 'We plan, create and operate.',
      support: 'The sequence changes with the project. The context stays connected.',
      close: 'Each project needs a different sequence. The context remains connected.',
      items: [
        ['Direction', 'Understand the business, organize priorities and define what needs to move forward.'],
        ['Expression', 'Turn strategy into identity, content, design, audiovisual and experiences.'],
        ['Operations', 'Connect planning, production, approval, publishing, follow-through and learning.'],
      ],
    },
    tech: {
      eyebrow: 'Cassiellos / Operating system',
      title: ['Technology behind the scenes.', 'Context at the front.'],
      body: 'We are building our own operational infrastructure to connect clients, plans, tasks, files, approvals, history and automations.',
      body2: 'cassiellOS helps preserve context and make work visible. Levi brings people and system closer through conversation, guidance and controlled actions.',
      close: 'Technology enters where it reduces friction. Judgment, direction and creation remain human.',
      osLabel: 'Operational infrastructure',
      osName: 'cassiellOS',
      osDesc: 'Organizes operational state without competing with the primary brand.',
      leviLabel: 'Intelligent interface',
      leviName: 'Levi',
      leviDesc: 'Connects people and system through context, guidance and controlled actions.',
      nodes: ['Clients', 'Plans', 'Tasks', 'Files', 'Approvals', 'History'],
    },
    process: {
      eyebrow: 'Visible process',
      title: 'Visible process. Real work.',
      body: 'Cassiellos image direction prioritizes gesture, focus, collaboration, depth and real working situations.',
      line: 'Planning / direction / design / audiovisual / technology / follow-through',
      placeholder: 'Real image slot',
      slots: ['Planning', 'Production', 'Creative', 'Review', 'Technology in use', 'Behind the scenes'],
    },
    people: {
      eyebrow: 'People',
      title: 'People who keep things moving.',
      body: 'Leadership is presented with an editorial presence. Official portraits will be placed here when they are available in the project.',
      placeholder: 'Official 3:4 portrait',
      pending: 'Official photo pending',
    },
    principles: {
      eyebrow: 'Operating principles',
      title: 'What must remain true as we grow.',
      body: 'Brand values become criteria for operations, decisions and relationships.',
      items: [
        ['Clarity', 'Objectives, owners, stages, decisions and next steps remain understandable.'],
        ['Continuity', 'Strong brands are built through coherent repetition, follow-through and evolution.'],
        ['Creativity with discipline', 'Strong ideas need direction, process and the ability to execute.'],
        ['Proximity', 'Understanding the client, their operations and context is part of the work.'],
        ['Technology with purpose', 'Reduce friction, preserve context and automate what is repeatable.'],
        ['Transparency', 'Make status, responsibilities, decisions and results visible and traceable.'],
      ],
    },
    cta: {
      eyebrow: 'Next move',
      title: ['Clarity to decide.', 'Rhythm to execute.', 'Consistency to grow.'],
      body: 'Tell us where your business is today. The first conversation starts with context.',
      button: 'Schedule a diagnostic',
    },
  },
} as const

const SLOT_CLASSES = ['slotWide', 'slotTall', 'slotMedium', 'slotSquare', 'slotLong', 'slotSmall'] as const
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
            <div className={styles.heroMeta} aria-label={lang === 'pt' ? 'Local e áreas de atuação' : 'Location and areas of work'}>
              {c.hero.meta.map((item) => <span key={item}>{item}</span>)}
            </div>
          </motion.div>

          <motion.div className={styles.brandMotion} {...reveal(0.08, 0)} aria-hidden>
            <i className={`${styles.brandRing} ${styles.ringOne}`} />
            <i className={`${styles.brandRing} ${styles.ringTwo}`} />
            <i className={`${styles.brandRing} ${styles.ringThree}`} />
            <InfinityMark className={styles.heroSymbol} />
            <small className={styles.motionCaption}>{c.hero.motionCaption}</small>
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} aria-labelledby="about-thesis-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.thesisIntro}>
            <motion.h2 id="about-thesis-title" className={`${styles.display} ${styles.sectionTitle}`} {...reveal(0)}>
              {c.thesis.title}
            </motion.h2>
            <motion.div className={styles.thesisCopy} {...reveal(0.08)}>
              {c.thesis.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </motion.div>
          </div>

          <div className={styles.editorialFlow} aria-label={lang === 'pt' ? 'Fluxo estratégico da Cassiellos' : 'Cassiellos strategic flow'}>
            {c.thesis.flow.map((step, index) => (
              <motion.div className={styles.flowStep} key={step} {...reveal(index * 0.06, 14)}>
                <span className={styles.flowIndex}>{String(index + 1).padStart(2, '0')}</span>
                <i className={styles.flowNode} aria-hidden />
                <strong>{step}</strong>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.navy}`} aria-labelledby="about-capabilities-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.capabilitiesHeader}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.capability.eyebrow}</span>
              <h2 id="about-capabilities-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.capability.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.capability.support}</motion.p>
          </div>

          <div className={styles.capabilities}>
            {c.capability.items.map(([title, description], index) => (
              <motion.article className={styles.capability} key={title} {...reveal(index * 0.06, 18)}>
                <span className={styles.capabilityIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3 className={styles.display}>{title}</h3>
                <p>{description}</p>
              </motion.article>
            ))}
          </div>
          <motion.p className={styles.capabilityClose} {...reveal(0.1)}>{c.capability.close}</motion.p>
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

      <section className={`${styles.section} ${styles.paper}`} aria-labelledby="about-process-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.processHeader}>
            <motion.div {...reveal(0)}>
              <span className={`tag ${styles.eyebrow}`}>{c.process.eyebrow}</span>
              <h2 id="about-process-title" className={`${styles.display} ${styles.sectionTitle}`}>{c.process.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.process.body}</motion.p>
          </div>
          <motion.div className={styles.processLine} {...reveal(0.08)}>{c.process.line}</motion.div>

          <div className={styles.processMosaic}>
            {c.process.slots.map((label, index) => (
              <motion.div
                key={label}
                className={`${styles.mediaSlot} ${styles[SLOT_CLASSES[index]]}`}
                role="img"
                aria-label={`${c.process.placeholder}: ${label}`}
                {...reveal(index * 0.05, 16)}
              >
                <div className={styles.mediaSlotText}>
                  <small>{c.process.placeholder}</small>
                  <strong>{label}</strong>
                </div>
              </motion.div>
            ))}
          </div>
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
                <div className={styles.portraitPlaceholder} role="img" aria-label={`${c.people.pending}: ${person.name}`}>
                  <div className={styles.portraitNote}>
                    <small>{c.people.placeholder}</small>
                    <span>{c.people.pending}</span>
                  </div>
                </div>
                <div className={styles.personCopy}>
                  <h3 className={styles.display}>{person.name}</h3>
                  <p>{person.role[lang]}</p>
                </div>
              </motion.article>
            ))}
          </div>
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
