import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

const title = 'A Empresa — Cassiellos'
const description = 'Conheça quem é a Cassiellos: uma empresa mineira de operações criativas construída por pessoas de estratégia, comunicação, design, audiovisual e tecnologia.'

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
