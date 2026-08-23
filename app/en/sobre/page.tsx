import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

export const metadata: Metadata = {
  title: 'About Cassiellos',
  description: 'Meet the team connecting strategy, creative and operations at Cassiellos.',
  alternates: { canonical: '/en/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
}

export default function EnglishAboutPage() {
  return <AboutContent lang="en" />
}
