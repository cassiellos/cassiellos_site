import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

const title = 'Company — Cassiellos'
const description = 'Meet Cassiellos: a creative operations company from Minas Gerais built by people working across strategy, communication, design, audiovisual and technology.'

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
  return <AboutContent lang="en" />
}
