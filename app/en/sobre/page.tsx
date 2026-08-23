import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

export const metadata: Metadata = {
  title: 'About Cassiellos — Creative Operations Company',
  description: 'Meet Cassiellos, a creative operations company connecting strategy, content, technology and follow-through to organize marketing from planning to publishing.',
  alternates: { canonical: '/en/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
}

export default function EnglishAboutPage() {
  return <AboutContent lang="en" />
}
