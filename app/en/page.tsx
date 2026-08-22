import type { Metadata } from 'next'
import HomeContent from '@/components/home-content'

export const metadata: Metadata = {
  title: 'Cassiellos — Creative Operations',
  description: 'Strategy, creative and execution connected in one consistent marketing operation.',
  alternates: { canonical: '/en', languages: { 'pt-BR': '/', en: '/en' } },
}

export default function EnglishHome() { return <HomeContent lang="en" /> }
