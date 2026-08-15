import Hero from '@/components/hero'
import Services from '@/components/services'
import Method from '@/components/method'
import OsSection from '@/components/os-section'
import LeviSection from '@/components/levi-section'
import Contact from '@/components/contact'
import Reveal from '@/components/reveal'

export default function Home() {
  return (
    <main id="top">
      <Hero />

      <section className="section">
        <div className="wrap intro">
          <Reveal>
            <span className="tag">01 / Posicionamento</span>
            <h2>Não é só sobre criar mais. É sobre operar melhor.</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            A Cassiellos conecta pensamento estratégico, criação e execução em uma operação única.
          </Reveal>
        </div>
      </section>

      <Services />
      <Method />
      <OsSection />
      <LeviSection />

      <section className="section" id="projetos">
        <div className="wrap">
          <div className="intro">
            <Reveal>
              <span className="tag">06 / Projetos</span>
              <h2>Marca, conteúdo e produto funcionando.</h2>
            </Reveal>
            <Reveal as="p" delay={0.1}>
              Cases publicados conforme autorização.
            </Reveal>
          </div>
        </div>
      </section>

      <Contact />
    </main>
  )
}
