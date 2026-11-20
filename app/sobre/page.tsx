import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'
import { BreadcrumbStructuredData } from '@/components/structured-data'

const title = 'Sobre a Cassiellos | Agência de Marketing em Belo Horizonte'
const description = 'Conheça a Cassiellos, agência de marketing em Belo Horizonte (MG) que atende empresas de todo o Brasil com estratégia, comunicação, design e audiovisual.'

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
  return (
    <>
      <BreadcrumbStructuredData items={[{ name: 'Início', path: '/' }, { name: 'Sobre a Cassiellos', path: '/sobre' }]} />
      <AboutContent lang="pt" />
    </>
  )
}
