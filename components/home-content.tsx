import Hero from './hero'
import Services from './services'
import Method from './method'
import LeviSection from './levi-section'
import Contact from './contact'
import Reveal from './reveal'

export type Locale = 'pt' | 'en'

export default function HomeContent({ lang }: { lang: Locale }) {
  const en = lang === 'en'
  return (
    <main id="top">
      <Hero lang={lang} />
      <section className="section statement">
        <div className="wrap statementGrid">
          <Reveal><span className="tag">01 / {en ? 'Essence' : 'Essência'}</span></Reveal>
          <Reveal delay={0.08}>
            <h2>{en ? 'Consistency to grow.' : 'Consistência para crescer.'}</h2>
            <p>{en ? 'Fewer initiatives that start and stop. More planning, standards and continuity so your company can maintain momentum and move forward without relying on improvisation.' : 'Menos ações que começam e param. Mais planejamento, padrão e continuidade para sua empresa manter o ritmo e avançar sem depender do improviso.'}</p>
          </Reveal>
          <Reveal className="statementProof" delay={0.16}>
            <span>{en ? 'Strategy' : 'Estratégia'}</span><span>{en ? 'Creative' : 'Criação'}</span><span>{en ? 'Operations' : 'Operação'}</span>
          </Reveal>
        </div>
      </section>
      <Services lang={lang} />
      <Method lang={lang} />
      <section className="section operation" id="operacao">
        <div className="wrap">
          <div className="intro operationIntro">
            <Reveal><span className="tag">04 / {en ? 'Brand in motion' : 'Marca em operação'}</span><h2>{en ? <>Visible process.<br />Real work.</> : <>Processo visível.<br />Trabalho real.</>}</h2></Reveal>
            <Reveal as="p" delay={0.1}>{en ? 'Every stage preserves decisions, owners, versions and next steps. Consistency grows because context remains accessible.' : 'Cada etapa preserva decisões, responsáveis, versões e próximos passos. O resultado ganha consistência porque o contexto permanece acessível.'}</Reveal>
          </div>
          <div className="operationBoard">
            {[
              ['01', en ? 'Plan' : 'Planejar', en ? 'Goals, priorities, calendar and dependencies.' : 'Objetivos, prioridades, calendário e dependências.', 'opCard opMain'],
              ['02', en ? 'Produce' : 'Produzir', en ? 'Briefs, scripts, design, video and versions.' : 'Briefings, roteiros, design, vídeo e versões.', 'opCard'],
              ['03', en ? 'Approve' : 'Aprovar', en ? 'Comments, decisions and traceable history.' : 'Comentários, decisões e histórico rastreável.', 'opCard'],
              ['04', en ? 'Learn' : 'Aprender', en ? 'Results and improvements return to the next cycle.' : 'Resultados e melhorias retornam ao próximo ciclo.', 'opCard opAccent'],
            ].map(([number, title, text, className], index) => <Reveal key={number} className={className} delay={index * .06}><span className="opIndex">{number}</span><div><b>{title}</b><p>{text}</p></div></Reveal>)}
          </div>
        </div>
      </section>
      <LeviSection lang={lang} />
      <Contact lang={lang} />
    </main>
  )
}
