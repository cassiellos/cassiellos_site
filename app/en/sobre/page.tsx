import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

const title = 'About Cassiellos — Creative Operations Company'
const description = 'Meet Cassiellos, a creative operations company connecting strategy, content, technology and follow-through to organize marketing from planning to publishing.'

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
