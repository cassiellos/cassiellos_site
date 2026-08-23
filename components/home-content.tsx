'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useLevi } from './levi-provider'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import Hero from './hero'
import styles from './home-content.module.css'

export type Locale = 'pt' | 'en'

const PT = {
  problem: {
    eyebrow: '02 / Isso acontece na sua empresa?',
    title: 'Seu marketing não deveria depender de você para funcionar.',
    body: 'Sua empresa cresce, mas o marketing começa a exigir cada vez mais atenção. Você precisa cobrar postagem, perguntar dos anúncios, procurar arquivos, revisar peças, aprovar tudo pelo WhatsApp e ainda tentar entender sozinho o que realmente está trazendo resultado.',
    points: [
      ['Cada profissional trabalha de um jeito', 'A comunicação perde consistência.'],
      ['Informações ficam espalhadas', 'Decisões e históricos se perdem.'],
      ['Não existe um plano claro', 'Tudo vira urgência.'],
      ['O acompanhamento é fraco', 'Você não sabe exatamente o que está funcionando.'],
      ['O dono coordena todo mundo', 'O marketing vira mais uma tarefa para administrar.'],
    ],
    close: 'A Cassiellos entra para organizar essa operação e fazer o marketing avançar com direção, criação e acompanhamento.',
  },
  services: {
    eyebrow: '03 / Como podemos ajudar',
    title: 'Cuidamos do marketing da sua empresa de ponta a ponta.',
    body: 'Você não precisa descobrir sozinho qual profissional contratar para cada problema. A Cassiellos reúne estratégia, criação e operação em uma mesma estrutura.',
    items: [
      { title: 'Planejar o que precisa ser feito', benefit: 'Entendemos o momento da sua empresa, identificamos prioridades e transformamos objetivos em um plano claro.', details: 'Estratégia · Posicionamento · Planejamento · Campanhas · Diagnóstico' },
      { title: 'Criar uma comunicação mais profissional', benefit: 'Transformamos estratégia em conteúdos e materiais que ajudam sua empresa a ser percebida, lembrada e escolhida.', details: 'Branding · Design · Redes sociais · Copywriting · Vídeos · Motion · Sites' },
      { title: 'Fazer o marketing acontecer', benefit: 'Organizamos calendário, produção, anúncios, materiais, acompanhamento e próximos passos para o trabalho continuar avançando.', details: 'Conteúdo · Mídia paga · Produção · Organização · Acompanhamento · Análise' },
    ],
  },
  benefits: {
    eyebrow: '04 / O que muda na prática',
    title: 'Marketing mais organizado muda muito mais do que a aparência da sua empresa.',
    rows: [
      ['Planejamento', 'Você sabe o que será feito e por quê.'],
      ['Conteúdo profissional', 'Sua empresa se comunica melhor e com mais consistência.'],
      ['Campanhas organizadas', 'Oferta, criação e mídia trabalham juntas.'],
      ['Acompanhamento', 'Você sabe o que está acontecendo sem precisar cobrar.'],
      ['Histórico e organização', 'Informações importantes deixam de ficar espalhadas.'],
      ['Análise', 'As próximas decisões aproveitam o que já aconteceu.'],
    ],
    close: ['Mais clareza para decidir.', 'Mais consistência para aparecer.', 'Mais tempo para cuidar da sua empresa.'],
  },
  proof: {
    eyebrow: '05 / Trabalho real',
    title: 'Veja o que já colocamos em movimento.',
    body: 'Projetos reais, clientes reais e entregas reais. Aqui, o foco é mostrar o que fizemos e como ajudamos cada operação.',
    cases: [
      { client: 'Minds English School', image: '/case-work/minds-intercambio.webp', alt: 'Peça de campanha criada para Minds English School', label: 'Campanhas, conteúdo e comunicação', title: 'Comunicação para campanhas, matrículas, produtos e posicionamento.', text: 'Planejamento e produção de peças com estratégia, copy, direção visual, conteúdo, criativos e campanhas.', services: 'Estratégia · Copy · Direção visual · Conteúdo · Criativos · Campanhas' },
      { client: 'Gira Moto Peças', image: '/case-work/gira-motopecas.webp', alt: 'Peça de conteúdo criada para Gira Moto Peças', label: 'Posicionamento, conteúdo e audiovisual', title: 'Uma linguagem para loja, oficina e diferentes públicos do mesmo negócio.', text: 'Comunicação construída para organizar produto, oficina e posicionamento dentro de uma presença mais forte e consistente.', services: 'Planejamento · Conteúdo · Design · Vídeo · Campanhas · Direção visual' },
      { client: 'Escola Santa Rita', image: '/case-work/santa-rita.webp', alt: 'Peça criada para Escola de Enfermagem Santa Rita', label: 'Comunicação educacional e geração de demanda', title: 'Conteúdo e campanhas voltados a cursos, matrículas e relacionamento.', text: 'Estratégia, conteúdo, copy, design, vídeos e campanhas trabalhando para divulgar a escola com clareza e consistência.', services: 'Estratégia · Conteúdo · Copy · Design · Vídeos · Campanhas' },
    ],
  },
  method: {
    eyebrow: '06 / Trabalhar com a Cassiellos',
    title: 'Você entende o que estamos fazendo e o que acontece depois.',
    body: 'Nosso processo é simples de acompanhar e mantém sua participação concentrada nas decisões que realmente precisam de você.',
    steps: [
      ['Entendemos sua empresa', 'Conversamos sobre seu negócio, objetivos, dificuldades e o que precisa melhorar primeiro.'],
      ['Organizamos o plano', 'Definimos prioridades, campanhas, conteúdos e ações.'],
      ['Criamos e colocamos em prática', 'Nosso time produz e executa o que foi planejado.'],
      ['Você acompanha', 'Mantemos você informado e concentramos sua participação nas decisões importantes.'],
      ['Aprendemos e melhoramos', 'Resultados e acontecimentos anteriores ajudam a orientar as próximas decisões.'],
    ],
  },
  os: {
    eyebrow: '07 / Tecnologia Cassiellos',
    title: 'Seu marketing organizado em um só lugar.',
    body: 'cassiellOS é a tecnologia que usamos para organizar nossa operação e concentrar informações importantes do trabalho. Com ele, tarefas, materiais, históricos e acompanhamento podem permanecer conectados ao longo do processo.',
    items: [
      ['Mais organização', 'Menos informação espalhada entre mensagens e arquivos.'],
      ['Mais visibilidade', 'Mais facilidade para entender o que está acontecendo.'],
      ['Mais contexto', 'O trabalho seguinte não precisa começar do zero.'],
    ],
  },
  levi: {
    eyebrow: 'LEVI by CASSIELLOS',
    title: 'Tem uma dúvida? Pergunte ao Levi.',
    body: 'Levi é o assistente da Cassiellos. Ele pode explicar nossos serviços, mostrar como trabalhamos e ajudar você a encontrar o que procura no site.',
    button: 'Perguntar ao Levi',
  },
  fit: {
    eyebrow: '08 / Para sua empresa',
    title: 'A Cassiellos faz sentido quando você quer levar o marketing mais a sério.',
    body: 'Para empresas que já entenderam que marketing precisa de investimento, planejamento e continuidade.',
    items: [
      'Sua empresa quer crescer e precisa gerar mais oportunidades.',
      'Você sente que o marketing ainda depende demais de improviso.',
      'Existem vários profissionais ou fornecedores, mas falta alguém organizando tudo.',
      'Você quer melhorar a qualidade da comunicação da empresa.',
      'Você quer acompanhar melhor seus investimentos e resultados.',
      'Você prefere ter estratégia, criação e operação trabalhando juntas.',
    ],
  },
  faq: {
    eyebrow: '09 / Perguntas frequentes',
    title: 'Antes de conversar com a gente, talvez você queira saber isso.',
    items: [
      ['A Cassiellos faz apenas redes sociais?', 'Não. Redes sociais podem fazer parte da estratégia, mas também trabalhamos com planejamento, campanhas, anúncios, branding, design, audiovisual, sites e organização da operação de marketing.'],
      ['Vocês também cuidam de anúncios?', 'Sim. Podemos planejar, criar e acompanhar campanhas de mídia paga quando esse canal fizer sentido para a estratégia da empresa.'],
      ['Preciso contratar todos os serviços?', 'Não. A estrutura é definida de acordo com o momento, os objetivos e as necessidades da empresa.'],
      ['Minha empresa precisa ter uma equipe de marketing?', 'Não necessariamente. Podemos trabalhar junto à sua equipe atual ou assumir partes da operação que hoje ainda não possuem estrutura.'],
      ['Como sei o que está sendo feito?', 'O trabalho possui planejamento, acompanhamento e organização. Nosso objetivo é que você consiga entender o que está acontecendo sem precisar administrar cada tarefa.'],
      ['Quanto preciso investir?', 'Isso depende da estrutura necessária, do volume de produção e dos objetivos da empresa. Na primeira conversa entendemos seu momento e indicamos uma estrutura compatível.'],
    ],
  },
  cta: {
    eyebrow: 'Próximo movimento',
    title: 'Quer entender o que faria mais sentido para sua empresa?',
    body: 'Conte um pouco sobre o momento atual do seu negócio. A conversa já começa a partir do que realmente precisa melhorar.',
    primary: 'Quero falar com a Cassiellos',
    secondary: 'Responder o pré-diagnóstico',
    note: 'Leva de 3 a 5 minutos. Sem compromisso.',
  },
}

const EN = {
  problem: {
    eyebrow: '02 / Is this happening in your company?',
    title: 'Your marketing should not depend on you to work.',
    body: 'As the company grows, marketing starts demanding more attention. You have to chase posts, ask about ads, find files, review pieces, approve everything in messages and still figure out what is actually working.',
    points: [
      ['Everyone works differently', 'Communication loses consistency.'],
      ['Information is scattered', 'Decisions and history get lost.'],
      ['There is no clear plan', 'Everything becomes urgent.'],
      ['Follow-up is weak', 'You do not know what is actually working.'],
      ['The owner coordinates everyone', 'Marketing becomes one more job to manage.'],
    ],
    close: 'Cassiellos organizes this operation so marketing can move forward with direction, creative and follow-through.',
  },
  services: {
    eyebrow: '03 / How we can help',
    title: 'We take care of your company’s marketing from end to end.',
    body: 'You do not need to figure out which professional to hire for every problem. Cassiellos brings strategy, creative and operations into one structure.',
    items: [
      { title: 'Plan what needs to happen', benefit: 'We understand your company, identify priorities and turn goals into a clear plan.', details: 'Strategy · Positioning · Planning · Campaigns · Diagnosis' },
      { title: 'Create more professional communication', benefit: 'We turn strategy into content and materials that help your company be noticed, remembered and chosen.', details: 'Branding · Design · Social media · Copywriting · Video · Motion · Websites' },
      { title: 'Make marketing happen', benefit: 'We organize calendars, production, ads, materials, follow-through and next steps so work keeps moving.', details: 'Content · Paid media · Production · Organization · Follow-through · Analysis' },
    ],
  },
  benefits: {
    eyebrow: '04 / What changes in practice',
    title: 'Organized marketing changes much more than how your company looks.',
    rows: [
      ['Planning', 'You know what will be done and why.'],
      ['Professional content', 'Your company communicates better and more consistently.'],
      ['Organized campaigns', 'Offer, creative and media work together.'],
      ['Follow-through', 'You know what is happening without chasing people.'],
      ['History and organization', 'Important information stops getting scattered.'],
      ['Analysis', 'Future decisions use what already happened.'],
    ],
    close: ['More clarity to decide.', 'More consistency to show up.', 'More time to run your company.'],
  },
  proof: {
    eyebrow: '05 / Real work',
    title: 'See what we have already put in motion.',
    body: 'Real projects, real clients and real deliverables. The focus here is what we did and how we helped each operation.',
    cases: [
      { client: 'Minds English School', image: '/case-work/minds-intercambio.webp', alt: 'Campaign piece created for Minds English School', label: 'Campaigns, content and communication', title: 'Communication for campaigns, enrollment, products and positioning.', text: 'Planning and production combining strategy, copy, visual direction, content, creative and campaigns.', services: 'Strategy · Copy · Visual direction · Content · Creative · Campaigns' },
      { client: 'Gira Moto Peças', image: '/case-work/gira-motopecas.webp', alt: 'Content piece created for Gira Moto Peças', label: 'Positioning, content and audiovisual', title: 'One language for store, workshop and different audiences.', text: 'Communication built to organize products, services and positioning into a stronger and more consistent presence.', services: 'Planning · Content · Design · Video · Campaigns · Visual direction' },
      { client: 'Escola Santa Rita', image: '/case-work/santa-rita.webp', alt: 'Piece created for Escola de Enfermagem Santa Rita', label: 'Educational communication and demand generation', title: 'Content and campaigns for courses, enrollment and relationships.', text: 'Strategy, content, copy, design, video and campaigns working together to communicate the school clearly and consistently.', services: 'Strategy · Content · Copy · Design · Video · Campaigns' },
    ],
  },
  method: {
    eyebrow: '06 / Working with Cassiellos',
    title: 'You understand what we are doing and what happens next.',
    body: 'Our process is easy to follow and keeps your participation focused on the decisions that actually need you.',
    steps: [
      ['We understand your company', 'We talk about your business, goals, difficulties and what needs to improve first.'],
      ['We organize the plan', 'We define priorities, campaigns, content and actions.'],
      ['We create and put it into practice', 'Our team produces and executes what was planned.'],
      ['You follow the work', 'We keep you informed and focus your participation on important decisions.'],
      ['We learn and improve', 'Results and previous events help guide the next decisions.'],
    ],
  },
  os: {
    eyebrow: '07 / Cassiellos technology',
    title: 'Your marketing organized in one place.',
    body: 'cassiellOS is the technology we use to organize our operation and keep important work information together. Tasks, materials, history and follow-through can stay connected throughout the process.',
    items: [
      ['More organization', 'Less information scattered across messages and files.'],
      ['More visibility', 'It becomes easier to understand what is happening.'],
      ['More context', 'The next piece of work does not need to start from zero.'],
    ],
  },
  levi: {
    eyebrow: 'LEVI by CASSIELLOS',
    title: 'Have a question? Ask Levi.',
    body: 'Levi is Cassiellos’ assistant. It can explain our services, show how we work and help you find what you are looking for on the site.',
    button: 'Ask Levi',
  },
  fit: {
    eyebrow: '08 / For your company',
    title: 'Cassiellos makes sense when you want to take marketing more seriously.',
    body: 'For companies that understand marketing needs investment, planning and continuity.',
    items: [
      'Your company wants to grow and needs more opportunities.',
      'Marketing still depends too much on improvisation.',
      'There are several professionals or suppliers, but nobody organizing the whole picture.',
      'You want to improve the quality of your company’s communication.',
      'You want to follow investments and results more clearly.',
      'You prefer strategy, creative and operations working together.',
    ],
  },
  faq: {
    eyebrow: '09 / Frequently asked questions',
    title: 'Before talking to us, you may want to know this.',
    items: [
      ['Does Cassiellos only manage social media?', 'No. Social media can be part of the strategy, but we also work with planning, campaigns, ads, branding, design, audiovisual, websites and marketing operations.'],
      ['Do you also manage ads?', 'Yes. We can plan, create and follow paid-media campaigns when that channel makes sense for the company’s strategy.'],
      ['Do I need to hire every service?', 'No. The structure is defined according to the company’s current moment, goals and needs.'],
      ['Does my company need an internal marketing team?', 'Not necessarily. We can work alongside your current team or take over parts of the operation that do not yet have structure.'],
      ['How do I know what is being done?', 'The work has planning, follow-through and organization. Our goal is for you to understand what is happening without having to manage every task.'],
      ['How much do I need to invest?', 'That depends on the structure, production volume and goals. In the first conversation, we understand your situation and recommend a compatible structure.'],
    ],
  },
  cta: {
    eyebrow: 'Next move',
    title: 'Want to understand what would make the most sense for your company?',
    body: 'Tell us a little about your business today. The conversation starts from what actually needs to improve.',
    primary: 'Talk to Cassiellos',
    secondary: 'Answer the pre-diagnostic',
    note: 'Takes 3 to 5 minutes. No commitment.',
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
    viewport: { once: true, amount: 0.16 },
    transition: { duration: 0.64, delay, ease },
  }

  return (
    <main id="top" className={styles.page}>
      <Hero lang={lang} />

      <section className={`${styles.section} ${styles.problem}`} aria-labelledby="problem-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal()}>
              <span className={`tag ${styles.eyebrow}`}>{c.problem.eyebrow}</span>
              <h2 id="problem-title">{c.problem.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.problem.body}</motion.p>
          </div>
          <div className={styles.problemGrid}>
            {c.problem.points.map(([title, text], index) => (
              <motion.article key={title} className={styles.problemCard} {...reveal(index * 0.05, 16)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
          <motion.p className={styles.problemClose} {...reveal(0.12)}>{c.problem.close}</motion.p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} id="servicos" aria-labelledby="services-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal()}>
              <span className={`tag ${styles.darkEyebrow}`}>{c.services.eyebrow}</span>
              <h2 id="services-title">{c.services.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.services.body}</motion.p>
          </div>
          <div className={styles.servicesGrid}>
            {c.services.items.map((item, index) => (
              <motion.article key={item.title} className={styles.serviceCard} {...reveal(index * 0.06, 18)}>
                <span className={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{item.title}</h3>
                <p>{item.benefit}</p>
                <small>{item.details}</small>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.benefits}`} aria-labelledby="benefits-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <motion.div {...reveal()}>
            <span className={`tag ${styles.darkEyebrow}`}>{c.benefits.eyebrow}</span>
            <h2 id="benefits-title">{c.benefits.title}</h2>
          </motion.div>
          <div className={styles.benefitRows}>
            {c.benefits.rows.map(([name, meaning], index) => (
              <motion.div className={styles.benefitRow} key={name} {...reveal(index * 0.04, 12)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{name}</strong>
                <p>{meaning}</p>
              </motion.div>
            ))}
          </div>
          <div className={styles.clarityBand}>
            {c.benefits.close.map((item, index) => <motion.strong key={item} {...reveal(index * 0.06, 14)}>{item}</motion.strong>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.proof}`} id="trabalhos" aria-labelledby="proof-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.splitIntro}>
            <motion.div {...reveal()}>
              <span className={`tag ${styles.darkEyebrow}`}>{c.proof.eyebrow}</span>
              <h2 id="proof-title">{c.proof.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.proof.body}</motion.p>
          </div>
          <div className={styles.caseGrid}>
            {c.proof.cases.map((item, index) => (
              <motion.article className={styles.caseCard} key={item.client} {...reveal(index * 0.06, 18)}>
                <figure><img src={item.image} alt={item.alt} loading="lazy" /></figure>
                <div className={styles.caseCopy}>
                  <span>{item.label}</span>
                  <small>{item.client}</small>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <em>{item.services}</em>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.method}`} id="como-funciona" aria-labelledby="method-title">
        <div className={`wrap ${styles.methodGrid}`}>
          <motion.div {...reveal()}>
            <span className={`tag ${styles.eyebrow}`}>{c.method.eyebrow}</span>
            <h2 id="method-title">{c.method.title}</h2>
            <p>{c.method.body}</p>
          </motion.div>
          <div className={styles.methodSteps}>
            {c.method.steps.map(([title, text], index) => (
              <motion.article key={title} className={styles.methodStep} {...reveal(index * 0.05, 14)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.osSection}`} id="cassiellos" aria-labelledby="os-title">
        <div className={`wrap ${styles.sectionInner}`}>
          <div className={styles.osIntro}>
            <motion.div {...reveal()}>
              <span className={`tag ${styles.systemEyebrow}`}>{c.os.eyebrow}</span>
              <h2 id="os-title">{c.os.title}</h2>
            </motion.div>
            <motion.p {...reveal(0.08)}>{c.os.body}</motion.p>
          </div>
          <motion.div className={styles.osPanel} {...reveal(0.12, 18)}>
            <img src="/brand/cassiellos-os-lockup.svg" alt="cassiellOS" />
            <div className={styles.osItems}>
              {c.os.items.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}
            </div>
          </motion.div>
          <motion.div className={styles.leviStrip} id="levi" {...reveal(0.16, 16)}>
            <div className={styles.leviMiniOrb} aria-hidden="true"><i></i></div>
            <div>
              <span>{c.levi.eyebrow}</span>
              <h3>{c.levi.title}</h3>
              <p>{c.levi.body}</p>
            </div>
            <button className="btn" type="button" onClick={() => openChat()}>{c.levi.button}</button>
          </motion.div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.fit}`} aria-labelledby="fit-title">
        <div className={`wrap ${styles.fitGrid}`}>
          <motion.div {...reveal()}>
            <span className={`tag ${styles.darkEyebrow}`}>{c.fit.eyebrow}</span>
            <h2 id="fit-title">{c.fit.title}</h2>
            <p>{c.fit.body}</p>
          </motion.div>
          <div className={styles.fitList}>
            {c.fit.items.map((item, index) => <motion.div key={item} {...reveal(index * 0.04, 12)}><span>✓</span><p>{item}</p></motion.div>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
        <div className={`wrap ${styles.faqGrid}`}>
          <motion.div {...reveal()}>
            <span className={`tag ${styles.eyebrow}`}>{c.faq.eyebrow}</span>
            <h2 id="faq-title">{c.faq.title}</h2>
          </motion.div>
          <div className={styles.faqList}>
            {c.faq.items.map(([question, answer], index) => (
              <motion.details key={question} {...reveal(index * 0.04, 10)}>
                <summary>{question}<span aria-hidden="true">+</span></summary>
                <p>{answer}</p>
              </motion.details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <div className={`wrap ${styles.ctaInner}`}>
          <motion.div {...reveal()}>
            <span className={`tag ${styles.ctaEyebrow}`}>{c.cta.eyebrow}</span>
            <h2 id="cta-title">{c.cta.title}</h2>
            <p>{c.cta.body}</p>
            <div className={styles.ctaActions}>
              <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{c.cta.primary}</a>
              <a className={`${styles.ctaSecondary} btn`} href="#contato">{c.cta.secondary}</a>
            </div>
            <small>{c.cta.note}</small>
          </motion.div>
        </div>
      </section>
    </main>
  )
}
