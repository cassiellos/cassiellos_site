import Hero from './hero'
import Services from './services'
import Method from './method'
import ProofSocial from './proof-social'
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
      <ProofSocial lang={lang} />
      <LeviSection lang={lang} />
      <Contact lang={lang} />
    </main>
  )
}
