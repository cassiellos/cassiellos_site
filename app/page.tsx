import Hero from '@/components/hero'
import Services from '@/components/services'
import Method from '@/components/method'
import LeviSection from '@/components/levi-section'
import Contact from '@/components/contact'
import Reveal from '@/components/reveal'

export default function Home() {
  return (
    <main id="top">
      <Hero />

      <section className="section statement">
        <div className="wrap statementGrid">
          <Reveal><span className="tag">01 / Essência</span></Reveal>
          <Reveal delay={0.08}>
            <h2>Consistência para crescer.</h2>
            <p>A Cassiellos estrutura o marketing de empresas que precisam avançar com direção, presença e continuidade.</p>
          </Reveal>
          <Reveal className="statementProof" delay={0.16}>
            <span>Estratégia</span><span>Criação</span><span>Operação</span>
          </Reveal>
        </div>
      </section>

      <Services />
      <Method />

      <section className="section operation" id="operacao">
        <div className="wrap">
          <div className="intro operationIntro">
            <Reveal>
              <span className="tag">04 / Marca em operação</span>
              <h2>Processo visível.<br />Trabalho real.</h2>
            </Reveal>
            <Reveal as="p" delay={0.1}>Cada etapa preserva decisões, responsáveis, versões e próximos passos. O resultado ganha consistência porque o contexto permanece acessível.</Reveal>
          </div>
          <div className="operationBoard">
            <Reveal className="opCard opMain">
              <span className="opIndex">01</span>
              <div><b>Planejar</b><p>Objetivos, prioridades, calendário e dependências.</p></div>
            </Reveal>
            <Reveal className="opCard" delay={0.06}>
              <span className="opIndex">02</span>
              <div><b>Produzir</b><p>Briefings, roteiros, design, vídeo e versões.</p></div>
            </Reveal>
            <Reveal className="opCard" delay={0.12}>
              <span className="opIndex">03</span>
              <div><b>Aprovar</b><p>Comentários, decisões e histórico rastreável.</p></div>
            </Reveal>
            <Reveal className="opCard opAccent" delay={0.18}>
              <span className="opIndex">04</span>
              <div><b>Aprender</b><p>Resultados e melhorias retornam ao próximo ciclo.</p></div>
            </Reveal>
          </div>
        </div>
      </section>

      <LeviSection />
      <Contact />
    </main>
  )
}
