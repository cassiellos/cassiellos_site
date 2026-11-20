import type { Metadata } from 'next'
import HomeContent from '@/components/home-content'
import ContactIntakeSection from '@/components/contact/ContactIntakeSection'
import { FaqStructuredData } from '@/components/structured-data'
import { FAQ_EN } from '@/lib/home-faq'

const title = 'Cassiellos | Marketing Agency in Belo Horizonte, Brazil'
const description = 'Marketing agency based in Belo Horizonte serving companies across Brazil: strategy, branding, social media, paid media, video and websites.'

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

export default function EnglishHome() {
  return (
    <>
      <FaqStructuredData items={FAQ_EN} />
      <HomeContent lang="en" />
      <ContactIntakeSection lang="en" />
    </>
  )
}
