import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

const title = 'Sobre a Cassiellos — Empresa de Operações Criativas'
const description = 'Conheça a Cassiellos, empresa de operações criativas que conecta estratégia, conteúdo, tecnologia e acompanhamento para organizar o marketing do planejamento à publicação.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
  openGraph: {
    title,
    description,
    url: '/sobre',
    type: 'website',
    locale: 'pt_BR',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
}

export default function AboutPage() {
  return <AboutContent lang="pt" />
}
