import type { Metadata } from 'next'
import HomeContent from '@/components/home-content'

const title = 'Cassiellos — Creative Operations'
const description = 'Strategy, content, creative and operations connected in one flow so companies can grow with more clarity, consistency and rhythm.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/en', languages: { 'pt-BR': '/', en: '/en' } },
  openGraph: {
    title,
    description,
    url: '/en',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
}

export default function EnglishHome() { return <HomeContent lang="en" /> }
