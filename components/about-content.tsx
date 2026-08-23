import InfinityMark from './infinity-mark'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'

type Locale = 'pt' | 'en'

const TEAM = [
  { initials: 'GC', name: 'Guilherme Cassim', role: { pt: 'CEO & Gerente de Marketing', en: 'CEO & Marketing Manager' } },
  { initials: 'DB', name: 'Daniel Barcellos', role: { pt: 'CEO & Gerente de Marketing', en: 'CEO & Marketing Manager' } },
  { initials: 'RT', name: 'Rafael Torres', role: { pt: 'Head Designer', en: 'Head Designer' } },
] as const

const FLOW = {
  pt: ['Objetivo', 'Roteiro', 'Preparação', 'Captação', 'Pós-produção', 'Aprovação', 'Publicação', 'Aprendizado'],
  en: ['Objective', 'Script', 'Preparation', 'Production', 'Post-production', 'Approval', 'Publishing', 'Learning'],
} as const

const PRINCIPLES = {
  pt: [
    ['Objetivo antes da imagem', 'Definimos o que comunicar, para quem e qual ação provocar.'],
    ['Clareza antes de ornamentação', 'Recursos técnicos entram quando ajudam a narrativa.'],
    ['Consistência', 'Padrões reduzem retrabalho sem impedir a criatividade.'],
    ['Toda entrega gera aprendizado', 'O resultado orienta a evolução, sem se tornar uma regra isolada.'],
  ],
  en: [
    ['Objective before image', 'We define what to communicate, to whom and which action to encourage.'],
    ['Clarity before ornament', 'Technical resources are used when they support the narrative.'],
    ['Consistency', 'Standards reduce rework without limiting creativity.'],
    ['Every delivery generates learning', 'Results guide improvement rather than becoming an isolated rule.'],
  ],
} as const

export default function AboutContent({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  return (
    <main id="top" className="aboutPage">
      <section className="aboutHero">
        <div className="aboutMesh" aria-hidden />
        <div className="wrap aboutHeroGrid">
          <div>
            <span className="tag">{en ? 'Cassiellos / About' : 'Cassiellos / Sobre'}</span>
            <h1>{en ? 'Organized marketing, from planning to publishing.' : 'Marketing organizado, do planejamento à publicação.'}</h1>
            <p className="lead">{en ? 'Cassiellos brings strategy, creativity and operations together so growing companies can move forward with greater clarity, consistency and confidence.' : 'A Cassiellos une estratégia, criação e operação para empresas que querem crescer com mais clareza, consistência e confiança.'}</p>
          </div>
          <div className="aboutHeroArt" aria-hidden>
            <i className="aboutOrbit aboutOrbitOne" />
            <i className="aboutOrbit aboutOrbitTwo" />
            <i className="aboutOrbit aboutOrbitThree" />
            <InfinityMark className="aboutInfinity" />
          </div>
        </div>
      </section>

      <section className="section aboutManifesto">
        <div className="wrap aboutStatement">
          <span className="tag">{en ? 'How we work' : 'Como trabalhamos'}</span>
          <div>
            <h2>{en ? 'A close team, built around the details that move a business forward.' : 'Um time próximo, construído em torno dos detalhes que fazem uma empresa avançar.'}</h2>
            <p>{en ? 'Every delivery combines commercial understanding, clear communication and consistent execution. The result is a marketing operation that supports leadership and gives the business more room to evolve.' : 'Cada entrega combina entendimento comercial, comunicação clara e execução consistente. O resultado é uma operação de marketing que apoia a liderança e cria mais espaço para a empresa evoluir.'}</p>
          </div>
        </div>
      </section>

      <section className="section aboutFlowSection">
        <div className="wrap">
          <div className="aboutFlowIntro">
            <div>
              <span className="tag">{en ? 'The Cassiellos system' : 'O sistema Cassiellos'}</span>
              <h2>{en ? 'From intent to execution, with criteria at every stage.' : 'Da intenção à execução, com critério em cada etapa.'}</h2>
            </div>
            <p>{en ? 'Strong marketing begins before the delivery: with a clear objective, a defined audience, the right message, context and the action each piece should encourage.' : 'Um marketing forte começa antes da entrega: com objetivo claro, público definido, mensagem, contexto e a ação que cada peça deve provocar.'}</p>
          </div>
          <ol className="aboutFlow" aria-label={en ? 'Cassiellos operating flow' : 'Fluxo operacional da Cassiellos'}>
            {FLOW[lang].map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="section aboutPrinciplesSection">
        <div className="wrap">
          <div className="aboutPrinciplesIntro">
            <span className="tag">{en ? 'Operating principles' : 'Princípios de operação'}</span>
            <h2>{en ? 'Quality is the coherence between objective, execution, experience and result.' : 'Qualidade é a coerência entre objetivo, execução, experiência e resultado.'}</h2>
          </div>
          <div className="aboutPrinciplesGrid">
            {PRINCIPLES[lang].map(([title, description], index) => (
              <article className="aboutPrinciple" key={title}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section aboutTeamSection">
        <div className="wrap">
          <div className="aboutTeamIntro">
            <div>
              <span className="tag">{en ? 'Leadership' : 'Liderança'}</span>
              <h2>{en ? 'The people behind Cassiellos.' : 'Quem conduz a Cassiellos.'}</h2>
            </div>
            <p>{en ? 'Official portraits will be added here soon. Until then, the cards keep the team structure clear.' : 'As fotos oficiais serão inseridas aqui em breve. Enquanto isso, os cards apresentam a estrutura do time.'}</p>
          </div>

          <div className="aboutTeamGrid">
            {TEAM.map((person) => (
              <article className="aboutPerson" key={person.name}>
                <div className="aboutPortrait" aria-label={en ? `Portrait placeholder for ${person.name}` : `Espaço reservado para a foto de ${person.name}`} role="img">
                  <InfinityMark className="aboutPortraitMark" />
                  <span>{person.initials}</span>
                  <small>{en ? 'Official portrait coming soon' : 'Foto oficial em breve'}</small>
                </div>
                <div className="aboutPersonCopy">
                  <h3>{person.name}</h3>
                  <p>{person.role[lang]}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section aboutContact">
        <div className="wrap">
          <span className="tag">{en ? 'Next conversation' : 'Próxima conversa'}</span>
          <h2>{en ? 'Let’s put your marketing into motion.' : 'Vamos colocar o seu marketing em movimento.'}</h2>
          <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}</a>
        </div>
      </section>
    </main>
  )
}
