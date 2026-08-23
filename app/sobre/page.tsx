import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

export const metadata: Metadata = {
  title: 'Sobre a Cassiellos',
  description: 'Conheça a equipe que conecta estratégia, criação e operação na Cassiellos.',
  alternates: { canonical: '/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
}

export default function AboutPage() {
  return <AboutContent lang="pt" />
}
