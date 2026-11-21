'use client'

import { useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { displayFont } from '@/lib/display-font'
import { ARTICLES, AWARDS, CASES, EXTRA_CLIENT_LOGOS, GUIDE, PARTNERS, SHOW_PLACEHOLDERS } from '@/lib/home-proof'
import HeroChrome from './hero-chrome'
import GlobeSquad from './globe-squad'
import CountUp from './count-up'
import { FAQ_EN, FAQ_PT } from '@/lib/home-faq'
import WhatsappCta from './whatsapp-cta'
import wa from './whatsapp-cta.module.css'
import styles from './home-v3.module.css'

export type Locale = 'pt' | 'en'

const PT = {
  logos: 'Empresas que confiam na Cassiellos',
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
    eyebrow: '05 / Clientes',
    title: 'Empresas que confiam na Cassiellos.',
    body: 'Trabalhamos ao lado de empresas de diferentes segmentos, construindo relações próximas e uma comunicação que acompanha o momento real de cada negócio.',
    cases: [
      { client: 'Minds English School', image: '/client-logos/current/minds.png', alt: 'Logo da Minds English School', label: 'Educação · Idiomas', title: 'Minds English School', text: 'Estratégia, conteúdo, campanhas e comunicação conectados à rotina comercial e institucional da escola.', services: 'Cliente Cassiellos' },
      { client: 'Gira Moto Peças', image: '/client-logos/current/gira-official.svg', alt: 'Logo da Gira Moto Peças', label: 'Varejo · Motopeças', title: 'Gira Moto Peças', text: 'Conteúdo, posicionamento, audiovisual e campanhas para uma operação que reúne loja, oficina e comunidade.', services: 'Cliente Cassiellos' },
      { client: 'Escola Santa Rita', image: '/client-logos/current/santa-rita.png', alt: 'Logo da Escola de Enfermagem Santa Rita', label: 'Educação · Saúde', title: 'Escola Santa Rita', text: 'Comunicação, conteúdo e campanhas para cursos técnicos, matrículas e relacionamento com futuros alunos.', services: 'Cliente Cassiellos' },
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
    items: FAQ_PT,
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
  logos: 'Companies that trust Cassiellos',
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
    eyebrow: '05 / Clients',
    title: 'Companies that trust Cassiellos.',
    body: 'We work alongside companies from different industries, building close relationships and communication that follows the real moment of each business.',
    cases: [
      { client: 'Minds English School', image: '/client-logos/current/minds.png', alt: 'Minds English School logo', label: 'Education · Languages', title: 'Minds English School', text: 'Strategy, content, campaigns and communication connected to the school’s commercial and institutional routine.', services: 'Cassiellos client' },
      { client: 'Gira Moto Peças', image: '/client-logos/current/gira-official.svg', alt: 'Gira Moto Peças logo', label: 'Retail · Motorcycle parts', title: 'Gira Moto Peças', text: 'Content, positioning, audiovisual and campaigns for an operation that brings store, workshop and community together.', services: 'Cassiellos client' },
      { client: 'Escola Santa Rita', image: '/client-logos/current/santa-rita.png', alt: 'Escola Santa Rita logo', label: 'Education · Healthcare', title: 'Escola Santa Rita', text: 'Communication, content and campaigns for technical courses, enrollment and relationships with future students.', services: 'Cassiellos client' },
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
    items: FAQ_EN,
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

/** Textos novos da estrutura v3 (globo, serviços em cartões, resultados, abordagem, blog, chamada final). */
const PT_V3 = {
  squad: {
    eyebrow: 'Squad Cassiellos',
    title: 'Seu time de marketing completo, em uma só estrutura.',
    body: 'Estratégia, criação, mídia e operação trabalhando juntas, com um time que conhece o seu negócio e acompanha cada etapa até o resultado.',
    button: 'Começar agora',
    labels: ['Estratégia', 'Conteúdo', 'Branding', 'Mídia paga', 'Vídeo', 'Sites', 'Design'],
  },
  servicesGrid: {
    eyebrow: 'Serviços',
    title: 'Estratégia, criação e operação. Sem improviso.',
    items: [
      ['Estratégia e posicionamento', 'Diagnóstico, prioridades e um plano claro para o marketing avançar com direção.'],
      ['Branding e design', 'Identidade visual e peças que fazem a sua empresa ser percebida, lembrada e escolhida.'],
      ['Conteúdo e redes sociais', 'Calendário, roteiros e produção contínua para a marca aparecer com consistência.'],
      ['Mídia paga', 'Campanhas planejadas, criadas e acompanhadas para gerar oportunidades reais.'],
      ['Vídeo e motion', 'Audiovisual e animação que explicam, emocionam e vendem.'],
      ['Sites e landing pages', 'Páginas rápidas e bonitas, pensadas para transformar visita em contato.'],
    ],
    more: 'Ver como funciona',
  },
  results: {
    eyebrow: 'Clientes',
    title: 'Considerada excelente por quem trabalha com a gente.',
    button: 'Quero resultados assim',
    fallbackAuthor: 'Cliente Cassiellos',
    more: 'Leia mais',
    sample: {
      tag: 'Modelo a preencher',
      quote: 'Frase de destaque do cliente, curta e entre aspas.',
      name: 'Nome do cliente',
      role: 'Cargo na empresa',
      metric: 'o que cresceu, em quanto tempo',
    },
  },
  recognition: {
    awards: 'Reconhecimentos e certificações',
    partners: 'Plataformas e parceiros',
  },
  approach: {
    eyebrow: 'Como trabalhamos',
    title: 'Uma forma diferente de fazer marketing.',
    body: 'Um processo simples de acompanhar, que concentra a sua participação nas decisões que realmente precisam de você.',
    prev: 'Anterior',
    next: 'Próximo',
  },
  faq: {
    eyebrow: 'Perguntas frequentes',
    title: 'Você tem dúvidas. A gente tem as respostas.',
  },
  blog: {
    eyebrow: 'Conteúdos',
    title: 'O que aprendemos fazendo marketing todos os dias.',
    button: 'Ver todos os conteúdos',
  },
  final: {
    title: 'Pronto para organizar seu marketing com a',
    brand: 'Cassiellos?',
    button: 'Fale com a gente',
  },
  placeholder: 'A preencher',
  wa: {
    logos: 'Quero ser o próximo case',
    squad: 'Montar meu time de marketing',
    services: 'Quero esses serviços',
    results: 'Quero resultados assim',
    recognition: 'Falar com a Cassiellos',
    approach: 'Começar pelo diagnóstico',
    faq: 'Ainda tem dúvidas? Chame no WhatsApp',
    blog: 'Conversar com um especialista',
  },
}

const EN_V3: typeof PT_V3 = {
  squad: {
    eyebrow: 'Cassiellos squad',
    title: 'Your complete marketing team, in one structure.',
    body: 'Strategy, creative, media and operations working together, with a team that knows your business and follows every step to the result.',
    button: 'Get started',
    labels: ['Strategy', 'Content', 'Branding', 'Paid media', 'Video', 'Websites', 'Design'],
  },
  servicesGrid: {
    eyebrow: 'Services',
    title: 'Strategy, creative and operations. No improvisation.',
    items: [
      ['Strategy and positioning', 'Diagnosis, priorities and a clear plan so marketing moves with direction.'],
      ['Branding and design', 'Visual identity and pieces that help your company be noticed, remembered and chosen.'],
      ['Content and social media', 'Calendar, scripts and continuous production so the brand shows up consistently.'],
      ['Paid media', 'Campaigns planned, created and followed to generate real opportunities.'],
      ['Video and motion', 'Audiovisual and animation that explain, move and sell.'],
      ['Websites and landing pages', 'Fast, beautiful pages built to turn visits into conversations.'],
    ],
    more: 'See how it works',
  },
  results: {
    eyebrow: 'Clients',
    title: 'Rated excellent by the people who work with us.',
    button: 'I want results like these',
    fallbackAuthor: 'Cassiellos client',
    more: 'Read more',
    sample: {
      tag: 'Template to fill',
      quote: 'Short highlight quote from the client.',
      name: 'Client name',
      role: 'Role at the company',
      metric: 'what grew, over what period',
    },
  },
  recognition: {
    awards: 'Recognition and certifications',
    partners: 'Platforms and partners',
  },
  approach: {
    eyebrow: 'How we work',
    title: 'A different way to do marketing.',
    body: 'A process that is easy to follow and keeps your participation focused on the decisions that actually need you.',
    prev: 'Previous',
    next: 'Next',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'You have questions. We have the answers.',
  },
  blog: {
    eyebrow: 'Insights',
    title: 'What we learn doing marketing every day.',
    button: 'See all insights',
  },
  final: {
    title: 'Ready to organize your marketing with',
    brand: 'Cassiellos?',
    button: 'Talk to us',
  },
  placeholder: 'To be filled',
  wa: {
    logos: 'I want to be the next case',
    squad: 'Build my marketing team',
    services: 'I want these services',
    results: 'I want results like these',
    recognition: 'Talk to Cassiellos',
    approach: 'Start with a diagnosis',
    faq: 'Still have questions? Message us',
    blog: 'Talk to a specialist',
  },
}

function Placeholder({ text, label }: { text: string; label: string }) {
  if (!SHOW_PLACEHOLDERS) return null
  return (
    <span className={styles.placeholder} title={text}>
      <b>{label}</b>
      <small>{text}</small>
    </span>
  )
}

const ease = [0.22, 1, 0.36, 1] as const

export default function HomeContent({ lang }: { lang: Locale }) {
  const c = lang === 'en' ? EN : PT
  const v = lang === 'en' ? EN_V3 : PT_V3
  const guide = GUIDE[lang]
  const cases = CASES[lang]
  const reduced = useReducedMotion()
  const trackRef = useRef<HTMLOListElement>(null)
  const reveal = (delay = 0, y = 24) => reduced ? {} : {
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.16 },
    transition: { duration: 0.64, delay, ease },
  }
  const slide = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector('li')
    track.scrollBy({ left: direction * ((card?.clientWidth ?? 480) + 20), behavior: reduced ? 'auto' : 'smooth' })
  }
  const logos = [
    ...cases.map((item) => ({ src: item.logo, alt: item.logoAlt })),
    ...EXTRA_CLIENT_LOGOS,
  ]

  return (
    <main id="top" className={`${styles.page} ${displayFont.variable}`}>
      <HeroChrome lang={lang} />

      <section className={styles.logos} aria-labelledby="logos-title">
        <div className="wrap">
          <h2 id="logos-title" className={styles.logosTitle}>{c.logos}</h2>
          <div className={styles.logoGrid}>
            {logos.map((logo, index) => logo
              ? <span className={styles.logoCell} key={logo.src}><img src={logo.src} alt={logo.alt} loading="lazy" /></span>
              : SHOW_PLACEHOLDERS && <span className={`${styles.logoCell} ${styles.logoEmpty}`} key={`vazio-${index}`}><Placeholder label={v.placeholder} text={guide.logo} /></span>)}
          </div>
          <div className={wa.row}><WhatsappCta section="logos" label={v.wa.logos} variant="ghost" /></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.squad}`} aria-labelledby="squad-title">
        <div className="wrap">
          <div className={styles.sectionHead}>
            <motion.div {...reveal()}>
              <span className={styles.eyebrow}>{v.squad.eyebrow}</span>
              <h2 id="squad-title" className={styles.display}>{v.squad.title}</h2>
            </motion.div>
            <motion.div className={styles.headAside} {...reveal(0.08)}>
              <p>{v.squad.body}</p>
              <a className={styles.textLink} href="#contato">{v.squad.button} <span aria-hidden="true">→</span></a>
            </motion.div>
          </div>
          <GlobeSquad labels={v.squad.labels} />
          <div className={wa.row}><WhatsappCta section="globo" label={v.wa.squad} /></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.servicesV3}`} id="servicos" aria-labelledby="services-title">
        <div className="wrap">
          <motion.div className={styles.sectionHeadSolo} {...reveal()}>
            <span className={styles.eyebrow}>{v.servicesGrid.eyebrow}</span>
            <h2 id="services-title" className={styles.display}>{v.servicesGrid.title}</h2>
          </motion.div>
          <div className={styles.serviceCards}>
            {v.servicesGrid.items.map(([title, text], index) => (
              <motion.article key={title} className={styles.serviceCard} {...reveal(index * 0.05, 18)}>
                <span className={styles.serviceNumber}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
          <div className={wa.row}>
            <WhatsappCta section="servicos" label={v.wa.services} />
            <a className="btn ghost" href="#como-funciona">{v.servicesGrid.more}</a>
          </div>
        </div>
      </section>

      <div className={styles.ticker} aria-hidden="true">
        <div className={`${styles.tickerTrack} ${reduced ? styles.marqueeStill : ''}`}>
          {[...c.benefits.close, ...c.benefits.close, ...c.benefits.close, ...c.benefits.close].map((item, index) => (
            <span key={`${item}-${index}`}>{item}<i>∞</i></span>
          ))}
        </div>
      </div>

      <section className={`${styles.section} ${styles.results}`} id="clientes" aria-labelledby="proof-title">
        <div className="wrap">
          <motion.div className={styles.sectionHeadSolo} {...reveal()}>
            <span className={styles.eyebrow}>{v.results.eyebrow}</span>
            <h2 id="proof-title" className={styles.display}>{cases.some((item) => item.quote) ? v.results.title : c.proof.title}</h2>
          </motion.div>
          <div className={styles.resultGrid}>
            {cases.map((item, index) => {
              const model = SHOW_PLACEHOLDERS && !item.quote
              const name = item.author?.name ?? (model ? v.results.sample.name : v.results.fallbackAuthor)
              const role = item.author?.role ?? (model ? v.results.sample.role : null)
              const words = name.split(/\s+/).filter(Boolean)
              const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase()
              const showMetric = item.metric || model
              const showMore = item.href || model
              return (
                <motion.article className={`${styles.resultCard} ${model ? styles.resultModel : ''}`} key={item.client} {...reveal(index * 0.06, 18)}>
                  {model && <span className={styles.resultTag} title={guide.quote}>{v.results.sample.tag}</span>}
                  <div className={styles.resultLogo}><img src={item.logoMono ?? item.logo} alt={item.logoAlt} loading="lazy" /></div>
                  <div className={styles.resultBody}>
                    {(item.quote || model) && (
                      <blockquote className={styles.resultQuote} title={model ? guide.quote : undefined}>“{item.quote ?? v.results.sample.quote}”</blockquote>
                    )}
                    <p className={styles.resultSummary}>{item.summary}</p>
                    <div className={styles.resultAuthor} title={model ? guide.author : undefined}>
                      {item.author?.photo
                        ? <img src={item.author.photo} alt="" loading="lazy" />
                        : (item.author || model) && <span className={styles.resultAvatar} aria-hidden="true">{initials}</span>}
                      <span className={styles.resultName}><b>{name}</b>{role && <small>{role}</small>}</span>
                    </div>
                  </div>
                  {(showMetric || showMore) && (
                    <div className={styles.resultFoot}>
                      {showMetric && (
                        <div className={styles.resultMetric} title={model ? guide.metric : undefined}>
                          <strong>
                            <span className={styles.resultArrow} aria-hidden="true">↑</span>
                            {item.metric
                              ? <CountUp value={item.metric.value} prefix={item.metric.prefix} suffix={item.metric.suffix} />
                              : <span>000%</span>}
                          </strong>
                          <small>{item.metric?.label ?? v.results.sample.metric}</small>
                        </div>
                      )}
                      {showMore && (
                        item.href
                          ? <a className={styles.resultMore} href={item.href}>{v.results.more} <span aria-hidden="true">→</span></a>
                          : <span className={styles.resultMore}>{v.results.more} <span aria-hidden="true">→</span></span>
                      )}
                    </div>
                  )}
                </motion.article>
              )
            })}
          </div>
          <div className={wa.row}>
            <WhatsappCta section="resultados" label={v.wa.results} />
          </div>
        </div>
      </section>

      {SHOW_PLACEHOLDERS || AWARDS.some(Boolean) || PARTNERS.some(Boolean) ? (
        <section className={styles.recognition} aria-label={v.recognition.awards}>
          <div className="wrap">
            {(SHOW_PLACEHOLDERS || AWARDS.some(Boolean)) && (
              <>
                <h2 className={styles.logosTitle}>{v.recognition.awards}</h2>
                <div className={styles.badgeRow}>
                  {AWARDS.map((item, index) => item
                    ? <span className={styles.badge} key={item.src}><img src={item.src} alt={item.alt} loading="lazy" /></span>
                    : SHOW_PLACEHOLDERS && <span className={`${styles.badge} ${styles.logoEmpty}`} key={`premio-${index}`}><Placeholder label={v.placeholder} text={guide.award} /></span>)}
                </div>
              </>
            )}
            {(SHOW_PLACEHOLDERS || PARTNERS.some(Boolean)) && (
              <>
                <h2 className={styles.logosTitle}>{v.recognition.partners}</h2>
                <div className={styles.badgeRow}>
                  {PARTNERS.map((item, index) => item
                    ? <span className={styles.badge} key={item.src}><img src={item.src} alt={item.alt} loading="lazy" /></span>
                    : SHOW_PLACEHOLDERS && <span className={`${styles.badge} ${styles.logoEmpty}`} key={`parceiro-${index}`}><Placeholder label={v.placeholder} text={guide.partner} /></span>)}
                </div>
              </>
            )}
            <div className={wa.row}><WhatsappCta section="reconhecimentos" label={v.wa.recognition} variant="ghost" /></div>
          </div>
        </section>
      ) : null}

      <section className={`${styles.section} ${styles.approach}`} id="como-funciona" aria-labelledby="method-title">
        <div className="wrap">
          <div className={styles.approachHead}>
            <motion.div {...reveal()}>
              <span className={styles.eyebrow}>{v.approach.eyebrow}</span>
              <h2 id="method-title" className={styles.display}>{v.approach.title}</h2>
              <p>{v.approach.body}</p>
            </motion.div>
            <div className={styles.carouselNav}>
              <button type="button" onClick={() => slide(-1)} aria-label={v.approach.prev}>←</button>
              <button type="button" onClick={() => slide(1)} aria-label={v.approach.next}>→</button>
            </div>
          </div>
        </div>
        <ol className={styles.approachTrack} ref={trackRef}>
          {c.method.steps.map(([title, text], index) => (
            <li key={title} className={styles.approachCard} data-tone={index % 3}>
              <span className={styles.approachNumber}>{index + 1}</span>
              <i className={styles.approachArt} aria-hidden="true"><b /><b /><b /><b /></i>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className={`wrap ${wa.row}`}><WhatsappCta section="abordagem" label={v.wa.approach} /></div>
      </section>

      <section className={`${styles.section} ${styles.faqV3}`} aria-labelledby="faq-title">
        <div className={`wrap ${styles.faqCenter}`}>
          <motion.div className={styles.centerHead} {...reveal()}>
            <span className={styles.eyebrow}>{v.faq.eyebrow}</span>
            <h2 id="faq-title" className={styles.display}>{v.faq.title}</h2>
          </motion.div>
          <div className={styles.faqCards}>
            {c.faq.items.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}<span aria-hidden="true">+</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
          <div className={wa.row}><WhatsappCta section="faq" label={v.wa.faq} /></div>
        </div>
      </section>

      {SHOW_PLACEHOLDERS || ARTICLES.some(Boolean) ? (
        <section className={`${styles.section} ${styles.blog}`} aria-labelledby="blog-title">
          <div className="wrap">
            <motion.div className={styles.sectionHeadSolo} {...reveal()}>
              <span className={styles.eyebrow}>{v.blog.eyebrow}</span>
              <h2 id="blog-title" className={styles.display}>{v.blog.title}</h2>
            </motion.div>
            <div className={styles.blogGrid}>
              {ARTICLES.map((article, index) => article
                ? (
                  <a className={styles.blogCard} key={article.href} href={article.href}>
                    {article.image && <img src={article.image} alt="" loading="lazy" />}
                    <small>{article.date}</small>
                    <h3>{article.title}</h3>
                  </a>
                )
                : SHOW_PLACEHOLDERS && (
                  <div className={`${styles.blogCard} ${styles.blogEmpty}`} key={`artigo-${index}`}>
                    <i className={styles.blogArt} data-tone={index % 3} aria-hidden="true" />
                    <Placeholder label={v.placeholder} text={guide.article} />
                  </div>
                ))}
            </div>
            <div className={wa.row}><WhatsappCta section="conteudos" label={v.wa.blog} variant="ghost" /></div>
          </div>
        </section>
      ) : null}

      <section className={styles.finalCta} aria-labelledby="final-cta-title">
        <div className={`wrap ${styles.finalInner}`}>
          <h2 id="final-cta-title" className={styles.display}>{v.final.title} <span>{v.final.brand}</span></h2>
          <WhatsappCta section="chamada-final" label={v.final.button} />
        </div>
      </section>
    </main>
  )
}
