import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'
import { BreadcrumbStructuredData } from '@/components/structured-data'

const title = 'About Cassiellos | Marketing Agency in Belo Horizonte, Brazil'
const description = 'Meet Cassiellos, a marketing agency in Belo Horizonte, Brazil, serving companies nationwide with strategy, communication, design and audiovisual.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/en/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
  openGraph: {
    title,
    description,
    url: '/en/sobre',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
}

export default function EnglishAboutPage() {
  return (
    <>
      <BreadcrumbStructuredData items={[{ name: 'Home', path: '/en' }, { name: 'About Cassiellos', path: '/en/sobre' }]} />
      <AboutContent lang="en" />
    </>
  )
}
