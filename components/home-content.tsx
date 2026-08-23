'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useLevi } from './levi-provider'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './home-content.module.css'

export type Locale = 'pt' | 'en'

type Copy = typeof PT

const PT = {
  hero: {
    eyebrow: 'Cassiellos / Operações criativas',
    titleA: 'Sua empresa já funciona.',
    titleB: 'Agora ela precisa funcionar melhor.',
    body: 'Estratégia, conteúdo, criação e operação conectados em um só fluxo para sua empresa crescer com mais clareza, consistência e ritmo.',
    primary: 'Agendar diagnóstico',
    secondary: 'Conhecer a Cassiellos',
  },
  essence: {
    eyebrow: '01 / Essência',
    title: 'Clareza em movimento.',
    items: [
      ['Clareza', 'para decidir.'],
      ['Ritmo', 'para executar.'],
      ['Consistência', 'para crescer.'],
    ],
  },
  problem: {
    eyebrow: '02 / O problema',
    title: 'Marketing fragmentado custa mais do que parece.',
    body: 'O peso aparece no retrabalho, nas decisões espalhadas, na dependência da memória e na dificuldade de entender o que aconteceu depois da publicação.',
    fragmentedLabel: 'Quando o contexto se perde',
    fragmented: ['Briefing', 'WhatsApp', 'Arquivo', 'Alteração', 'Aprovação', 'Postagem', 'Resultado', 'Contexto perdido'],
    connectedLabel: 'Quando o contexto continua',
    connected: ['Contexto', 'Direção', 'Produção', 'Aprovação', 'Publicação', 'Resultado', 'Aprendizado'],
  },
  expertise: {
    eyebrow: '03 / Atuação',
    title: 'A Cassiellos planeja, cria e opera.',
    body: 'As disciplinas entram conforme a necessidade. O que permanece é a responsabilidade por fazer o trabalho avançar com direção e continuidade.',
    items: [
      ['Saiba o que fazer', 'Clareza para tomar decisões melhores.', 'Diagnóstico, direção, estratégia, posicionamento e planejamento.'],
      ['Comunique melhor', 'Uma marca mais preparada para ser entendida e valorizada.', 'Design, identidade, conteúdo, audiovisual, campanhas, motion e experiências.'],
      ['Mantenha tudo funcionando', 'Menos improviso e mais continuidade.', 'Calendário, produção, arquivos, aprovação, publicação, acompanhamento, dados e operação.'],
    ],
  },
  method: {
    eyebrow: '04 / Método',
    title: 'Um ciclo que melhora a cada volta.',
    body: 'O processo preserva decisões e aprendizados para que cada nova etapa comece com mais contexto do que a anterior.',
    steps: ['Diagnóstico', 'Direção', 'Produção', 'Aprovação', 'Aprendizado'],
    close: 'Repetir com melhoria',
  },
  os: {
    eyebrow: '05 / Cassiellos / Produto',
    title: 'Seu marketing, com contexto em um só lugar.',
    body: 'O cassiellOS é o aplicativo proprietário de gestão, CRM e acompanhamento da operação da Cassiellos. Ele organiza o trabalho interno e está evoluindo para tornar a experiência do cliente mais transparente, simples e acompanhável.',
    benefit: 'Você acompanha o que precisa para entender, decidir e avançar, enquanto a complexidade operacional permanece onde deve estar: dentro da Cassiellos.',
    labels: ['Visibilidade', 'Contexto', 'Controle', 'Acompanhamento'],
    liveTitle: 'Estado verificado no produto',
    live: [
      ['Dashboard', 'Em uso no DEV atual'],
      ['TaskFlow', 'Em uso no DEV atual'],
      ['MediaFlow', 'Disponível na operação atual'],
      ['AnalyticsFlow', 'Fundação em desenvolvimento'],
    ],
    roadmapTitle: 'Experiência externa em construção',
    roadmap: 'A arquitetura prevê uma superfície simplificada para clientes com acompanhamento, aprovações, calendário, relatórios e outras áreas. Essas capacidades entram por etapas e não são apresentadas aqui como funcionalidades já liberadas.',
  },
  levi: {
    eyebrow: '06 / LEVI by CASSIELLOS',
    title: 'Seu assistente dentro da operação.',
    body: 'Levi é a interface inteligente da Cassiellos. No site, ele já ajuda a orientar a navegação e responder dúvidas. Dentro da evolução do cassiellOS, ele aproxima pessoas do contexto organizado pelo sistema, sempre respeitando permissões e o estado real de cada funcionalidade.',
    examplesTitle: 'Exemplos de interação',
    examples: ['O que é o cassiellOS?', 'Qual é o próximo passo?', 'Quero falar com a equipe.', 'Como a Cassiellos trabalha?'],
    note: 'Perguntas relacionadas a aprovações, calendário, relatórios e resultados passam a fazer parte da experiência conforme essas superfícies forem disponibilizadas.',
    button: 'Conversar com o Levi',
  },
  proof: {
    eyebrow: '07 / Trabalho real',
    title: 'A prova aparece no trabalho.',
    body: 'Projetos reais, clientes reais e peças reais. Sem números inventados e sem transformar logo em case.',
    cases: [
      {
        client: 'Minds English School',
        image: '/case-work/minds-intercambio.webp',
        alt: 'Peça de campanha de intercâmbio criada para Minds English School',
        label: 'Campanha / Conteúdo',
        title: 'Comunicação para uma oferta que precisava virar desejo.',
        text: 'Peça real de campanha de intercâmbio, com direção visual, hierarquia de mensagem e desdobramento pensado para mídia social.',
      },
      {
        client: 'Gira Moto Peças',
        image: '/case-work/gira-motopecas.webp',
        alt: 'Peça de conteúdo criada para Gira Moto Peças',
        label: 'Conteúdo / Direção visual',
        title: 'Produto, oficina e posicionamento na mesma linguagem.',
        text: 'Peça real criada para sustentar uma comunicação mais forte e coerente com o universo de motos, peças e oficina.',
      },
      {
        client: 'Escola Santa Rita',
        image: '/case-work/santa-rita.webp',
        alt: 'Peça educacional criada para Escola de Enfermagem Santa Rita',
        label: 'Conteúdo / Educação',
        title: 'Conteúdo que ensina enquanto posiciona a escola.',
        text: 'Peça real de comunicação educacional, combinando argumento técnico, marca e convite comercial em uma única composição.',
      },
    ],
  },
  process: {
    eyebrow: '08 / Processo visível',
    title: 'Trabalho real deixa rastros.',
    body: 'Planejamento, direção, criação, captação, revisão e acompanhamento fazem parte da entrega. A tecnologia conecta essas etapas; a qualidade continua dependendo de pessoas, repertório e decisão.',
    line: ['Planejamento', 'Direção', 'Criação', 'Audiovisual', 'Revisão', 'Acompanhamento'],
  },
  cta: {
    eyebrow: 'Próximo movimento',
    title: 'Vamos organizar o que precisa avançar.',
    body: 'Conte o momento da sua empresa. A primeira conversa começa pelo contexto.',
    button: 'Agendar diagnóstico',
    close: ['Clareza para decidir.', 'Ritmo para executar.', 'Consistência para crescer.'],
  },
} as const

const EN: Copy = {
  hero: {
    eyebrow: 'Cassiellos / Creative operations',
    titleA: 'Your company already works.',
    titleB: 'Now it needs to work better.',
    body: 'Strategy, content, creative and operations connected in one flow so your company can grow with more clarity, consistency and rhythm.',
    primary: 'Schedule a diagnostic',
    secondary: 'Meet Cassiellos',
  },
  essence: {
    eyebrow: '01 / Essence',
    title: 'Clarity in motion.',
    items: [['Clarity', 'to decide.'], ['Rhythm', 'to execute.'], ['Consistency', 'to grow.']],
  },
  problem: {
    eyebrow: '02 / The problem',
    title: 'Fragmented marketing costs more than it seems.',
    body: 'The cost appears as rework, scattered decisions, dependence on memory and difficulty understanding what happened after publishing.',
    fragmentedLabel: 'When context gets lost',
    fragmented: ['Brief', 'Messages', 'File', 'Change', 'Approval', 'Publishing', 'Result', 'Lost context'],
    connectedLabel: 'When context continues',
    connected: ['Context', 'Direction', 'Production', 'Approval', 'Publishing', 'Result', 'Learning'],
  },
  expertise: {
    eyebrow: '03 / Expertise',
    title: 'Cassiellos plans, creates and operates.',
    body: 'Disciplines enter according to the need. What remains is the responsibility to keep work moving with direction and continuity.',
    items: [
      ['Know what to do', 'Clarity for better decisions.', 'Diagnosis, direction, strategy, positioning and planning.'],
      ['Communicate better', 'A brand better prepared to be understood and valued.', 'Design, identity, content, audiovisual, campaigns, motion and experiences.'],
      ['Keep it running', 'Less improvisation and more continuity.', 'Calendar, production, files, approval, publishing, follow-through, data and operations.'],
    ],
  },
  method: {
    eyebrow: '04 / Method',
    title: 'A cycle that improves with every turn.',
    body: 'The process preserves decisions and learning so every new stage starts with more context than the one before it.',
    steps: ['Diagnosis', 'Direction', 'Production', 'Approval', 'Learning'],
    close: 'Repeat with improvement',
  },
  os: {
    eyebrow: '05 / Cassiellos / Product',
    title: 'Your marketing, with context in one place.',
    body: 'cassiellOS is Cassiellos’ proprietary management, CRM and operational follow-through application. It organizes internal work and is evolving to make the client experience more transparent, simple and easy to follow.',
    benefit: 'You see what you need to understand, decide and move forward while operational complexity stays inside Cassiellos.',
    labels: ['Visibility', 'Context', 'Control', 'Follow-through'],
    liveTitle: 'Verified product state',
    live: [['Dashboard', 'In use in current DEV'], ['TaskFlow', 'In use in current DEV'], ['MediaFlow', 'Available in current operation'], ['AnalyticsFlow', 'Foundation in development']],
    roadmapTitle: 'External experience in development',
    roadmap: 'The architecture includes a simplified client surface for follow-through, approvals, calendar, reports and other areas. These capabilities are being introduced in stages and are not presented here as already released.',
  },
  levi: {
    eyebrow: '06 / LEVI by CASSIELLOS',
    title: 'Your assistant inside the operation.',
    body: 'Levi is Cassiellos’ intelligent interface. On the website, it already helps guide navigation and answer questions. As cassiellOS evolves, Levi brings people closer to the context organized by the system while respecting permissions and the real state of each capability.',
    examplesTitle: 'Interaction examples',
    examples: ['What is cassiellOS?', 'What is the next step?', 'I want to talk to the team.', 'How does Cassiellos work?'],
    note: 'Questions about approvals, calendar, reports and results become part of the experience as those surfaces are released.',
    button: 'Talk to Levi',
  },
  proof: {
    eyebrow: '07 / Real work',
    title: 'The proof is in the work.',
    body: 'Real projects, real clients and real pieces. No invented numbers and no logo grids pretending to be case studies.',
    cases: [
      { client: 'Minds English School', image: '/case-work/minds-intercambio.webp', alt: 'Exchange program campaign piece created for Minds English School', label: 'Campaign / Content', title: 'Communication built to turn an offer into desire.', text: 'A real exchange-program campaign piece combining visual direction, message hierarchy and social-media deployment.' },
      { client: 'Gira Moto Peças', image: '/case-work/gira-motopecas.webp', alt: 'Content piece created for Gira Moto Peças', label: 'Content / Visual direction', title: 'Product, workshop and positioning in one language.', text: 'A real piece created to support a stronger communication system for the world of motorcycles, parts and service.' },
      { client: 'Escola Santa Rita', image: '/case-work/santa-rita.webp', alt: 'Educational content piece created for Escola de Enfermagem Santa Rita', label: 'Content / Education', title: 'Content that teaches while positioning the school.', text: 'A real educational communication piece combining technical argument, brand and commercial invitation in one composition.' },
    ],
  },
  process: {
    eyebrow: '08 / Visible process',
    title: 'Real work leaves a trail.',
    body: 'Planning, direction, creative, production, review and follow-through are part of the delivery. Technology connects the stages; quality still depends on people, repertoire and decisions.',
    line: ['Planning', 'Direction', 'Creative', 'Audiovisual', 'Review', 'Follow-through'],
  },
  cta: {
    eyebrow: 'Next move',
    title: 'Let’s organize what needs to move forward.',
    body: 'Tell us where your business is today. The first conversation starts with context.',
    button: 'Schedule a diagnostic',
    close: ['Clarity to decide.', 'Rhythm to execute.', 'Consistency to grow.'],
  },
}

const ease = [0.22, 1, 0.36, 1] as const

export default function HomeContent({ lang }: { lang: Locale }) {
  const c = lang === 'en' ? EN : PT
  const reduced = useReducedMotion()
  const { openChat } = useLevi()
  const reveal = (delay = 0, y = 24) => reduced ? {} : {
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.18 },
    transition: { duration: 0.64, delay, ease },
  }

  return (
    <main id="top" className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-hero-title">
        <div className={styles.gridTexture} aria-hidden="true" />
        <div className={`wrap ${styles.heroGrid}`}>
          <motion.div className={styles.heroCopy} {...reveal(0)}>
            <span className={`tag ${styles.eyebrow}`}>{c.hero.eyebrow}</span>
            <h1 id="home-hero-title"><span>{c.hero.titleA}</span><span className={styles.heroAccent}>{c.hero.titleB}</span></h1>
            <p>{c.hero.body}</p>
            <div className={styles.actions}>
              <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{c.hero.primary}</a>
              <a className={`btn ghost ${styles.secondaryButton}`} href={lang === 'en' ? '/en/sobre' : '/sobre'}>{c.hero.secondary}</a>
            </div>
          </motion.div>

          <motion.div className={styles.orbitStage} {...reveal(0.08, 0)} aria-hidden="true">
            <i className={`${styles.brandRing} ${styles.ringOne}`} />
            <i className={`${styles.brandRing} ${styles.ringTwo}`} />
            <i className={`${styles.brandRing} ${styles.ringThree}`} />
            <img className={styles.heroSymbol} src="/brand/cassiellos-symbol-signal-red.svg" alt="" />
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.essence}`} aria-labelledby="essence-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <motion.div {...reveal(0)}><span className={`tag ${styles.darkEyebrow}`}>{c.essence.eyebrow}</span><h2 id="essence-title">{c.essence.title}</h2></motion.div>
          <div className={styles.essenceLines}>
            {c.essence.items.map(([strong, tail], index) => (
              <motion.div key={strong} className={styles.essenceLine} {...reveal(index * 0.07, 18)}>
                <span>{String(index + 1).padStart(2, '0')}</span><strong>{strong}</strong><em>{tail}</em>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.problem}`} aria-labelledby="problem-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal(0)}><span className={`tag ${styles.eyebrow}`}>{c.problem.eyebrow}</span><h2 id="problem-title">{c.problem.title}</h2></motion.div>
            <motion.p {...reveal(0.08)}>{c.problem.body}</motion.p>
          </div>
          <div className={styles.flowCompare}>
            <motion.article className={styles.fragmentedFlow} {...reveal(0.08, 18)}>
              <span className={styles.flowLabel}>{c.problem.fragmentedLabel}</span>
              <div className={styles.flowNodes}>{c.problem.fragmented.map((item, index) => <span key={item} data-last={index === c.problem.fragmented.length - 1}>{item}</span>)}</div>
            </motion.article>
            <motion.article className={styles.connectedFlow} {...reveal(0.14, 18)}>
              <span className={styles.flowLabel}>{c.problem.connectedLabel}</span>
              <div className={styles.flowNodes}>{c.problem.connected.map((item) => <span key={item}>{item}</span>)}<b aria-hidden="true">↻</b></div>
            </motion.article>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} id="atuacao" aria-labelledby="expertise-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal(0)}><span className={`tag ${styles.darkEyebrow}`}>{c.expertise.eyebrow}</span><h2 id="expertise-title">{c.expertise.title}</h2></motion.div>
            <motion.p {...reveal(0.08)}>{c.expertise.body}</motion.p>
          </div>
          <div className={styles.expertiseGrid}>
            {c.expertise.items.map(([title, promise, detail], index) => (
              <motion.article key={title} className={styles.expertiseCard} {...reveal(index * 0.06, 18)}>
                <span className={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><strong>{promise}</strong><p>{detail}</p></div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.method}`} id="metodo" aria-labelledby="method-title">
        <div className={`wrap ${styles.methodGrid}`}>
          <motion.div {...reveal(0)}><span className={`tag ${styles.eyebrow}`}>{c.method.eyebrow}</span><h2 id="method-title">{c.method.title}</h2><p>{c.method.body}</p></motion.div>
          <div className={styles.cycle} aria-label={c.method.steps.join(', ')}>
            <div className={styles.cycleRail} aria-hidden="true" />
            {c.method.steps.map((step, index) => (
              <motion.div key={step} className={styles.cycleStep} {...reveal(index * 0.06, 14)}>
                <span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong>
              </motion.div>
            ))}
            <motion.div className={styles.cycleClose} {...reveal(0.28, 12)}><span aria-hidden="true">↻</span>{c.method.close}</motion.div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.osSection}`} id="cassiellos" aria-labelledby="os-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.osIntro}>
            <motion.div {...reveal(0)}><span className={`tag ${styles.systemEyebrow}`}>{c.os.eyebrow}</span><h2 id="os-title">{c.os.title}</h2></motion.div>
            <motion.div {...reveal(0.08)}><p>{c.os.body}</p><strong>{c.os.benefit}</strong></motion.div>
          </div>
          <motion.div className={styles.osCanvas} {...reveal(0.1, 18)}>
            <div className={styles.osBrand}><img src="/brand/cassiellos-os-lockup.svg" alt="cassiellOS" /></div>
            <div className={styles.osBenefits}>{c.os.labels.map((label) => <span key={label}>{label}</span>)}</div>
            <div className={styles.osStatusGrid}>
              <div><small>{c.os.liveTitle}</small>{c.os.live.map(([name, status]) => <div className={styles.statusRow} key={name}><strong>{name}</strong><span>{status}</span></div>)}</div>
              <div className={styles.roadmapCard}><small>{c.os.roadmapTitle}</small><p>{c.os.roadmap}</p></div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.leviSection}`} id="levi" aria-labelledby="levi-title">
        <div className={`wrap ${styles.leviGrid}`}>
          <motion.div className={styles.leviVisual} {...reveal(0, 0)} aria-hidden="true">
            <i className={`${styles.leviRing} ${styles.leviRingOne}`} /><i className={`${styles.leviRing} ${styles.leviRingTwo}`} /><i className={styles.leviCore} />
          </motion.div>
          <motion.div className={styles.leviCopy} {...reveal(0.08)}>
            <span className={`tag ${styles.systemEyebrow}`}>{c.levi.eyebrow}</span>
            <h2 id="levi-title">{c.levi.title}</h2><p>{c.levi.body}</p>
            <div className={styles.questionPanel}><small>{c.levi.examplesTitle}</small>{c.levi.examples.map((item) => <button type="button" key={item} onClick={openChat}>{item}</button>)}</div>
            <p className={styles.leviNote}>{c.levi.note}</p>
            <button className="btn" type="button" onClick={openChat}>{c.levi.button}</button>
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.proof}`} id="prova-social" aria-labelledby="proof-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal(0)}><span className={`tag ${styles.darkEyebrow}`}>{c.proof.eyebrow}</span><h2 id="proof-title">{c.proof.title}</h2></motion.div>
            <motion.p {...reveal(0.08)}>{c.proof.body}</motion.p>
          </div>
          <div className={styles.caseGrid}>
            {c.proof.cases.map((item, index) => (
              <motion.article className={styles.caseCard} key={item.client} {...reveal(index * 0.07, 18)}>
                <figure><img src={item.image} alt={item.alt} loading="lazy" /></figure>
                <div className={styles.caseCopy}><span>{item.label}</span><small>{item.client}</small><h3>{item.title}</h3><p>{item.text}</p></div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.process}`} aria-labelledby="process-title">
        <div className={`wrap ${styles.processGrid}`}>
          <motion.div {...reveal(0)}><span className={`tag ${styles.eyebrow}`}>{c.process.eyebrow}</span><h2 id="process-title">{c.process.title}</h2></motion.div>
          <motion.div {...reveal(0.08)}><p>{c.process.body}</p><div className={styles.processLine}>{c.process.line.map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, '0')}</b>{item}</span>)}</div></motion.div>
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <div className={`wrap ${styles.ctaInner}`}>
          <motion.div {...reveal(0)}><span className={`tag ${styles.eyebrow}`}>{c.cta.eyebrow}</span><h2 id="cta-title">{c.cta.title}</h2><p>{c.cta.body}</p><a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{c.cta.button}</a></motion.div>
          <motion.div className={styles.ctaClose} {...reveal(0.12, 16)}>{c.cta.close.map((line) => <strong key={line}>{line}</strong>)}</motion.div>
        </div>
      </section>
    </main>
  )
}
