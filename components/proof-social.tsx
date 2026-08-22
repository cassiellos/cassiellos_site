import Image from 'next/image'
import InfinityMark from './infinity-mark'
import Reveal from './reveal'
import type { Locale } from './home-content'

const CLIENTS = [
  {
    name: 'Minds English School',
    image: '/client-logos/minds.png',
    width: 492,
    height: 250,
    className: 'clientLogo mindsLogo',
  },
  {
    name: 'Gira Moto Peças',
    image: '/client-logos/gira.jpeg',
    width: 2560,
    height: 762,
    className: 'clientLogo giraLogo',
  },
  {
    name: 'Santa Rita Escola de Enfermagem',
    image: '/client-logos/santa-rita.png',
    width: 1024,
    height: 246,
    className: 'clientLogo santaLogo',
  },
] as const

export default function ProofSocial({ lang }: { lang: Locale }) {
  const en = lang === 'en'

  return (
    <section className="section proofSection" id="prova-social">
      <div className="wrap">
        <div className="intro proofIntro">
          <Reveal>
            <span className="tag">04 / {en ? 'Proof' : 'Prova social'}</span>
            <h2>{en ? 'When every detail matters.' : 'Quando cada detalhe importa.'}</h2>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            {en
              ? 'Your company already has value. Now it deserves communication that shows it.'
              : 'Sua empresa já tem valor. Agora ela merece uma comunicação que mostre isso.'}
          </Reveal>
        </div>

        <Reveal className="proofVideo" delay={0.08}>
          <span className="videoEyebrow">{en ? 'Cassiellos selection' : 'Seleção Cassiellos'}</span>
          <div className="videoCenter" role="img" aria-label={en ? 'Showreel video placeholder' : 'Espaço reservado para o vídeo dos melhores trabalhos'}>
            <span className="proofPlay" aria-hidden><span /></span>
            <strong>{en ? 'Our best work' : 'Nossos melhores trabalhos'}</strong>
            <small>{en ? 'Showreel in production' : 'Vídeo em produção'}</small>
          </div>
          <InfinityMark className="videoMark" />
          <span className="videoTime" aria-hidden>00:00 — 01:00</span>
        </Reveal>

        <div className="clientProof">
          <Reveal>
            <h3>{en ? 'Companies transformed by Cassiellos' : 'Empresas que foram transformadas pela Cassiellos'}</h3>
          </Reveal>
          <div className="clientGrid">
            {CLIENTS.map((client, index) => (
              <Reveal key={client.name} className="clientTile" delay={0.06 * index}>
                <Image
                  className={client.className}
                  src={client.image}
                  alt={client.name}
                  width={client.width}
                  height={client.height}
                  sizes="(max-width: 620px) 88vw, (max-width: 960px) 45vw, 30vw"
                />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
