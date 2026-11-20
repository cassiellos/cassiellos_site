import type { Metadata, Viewport } from 'next'
import { Inter, Inter_Tight } from 'next/font/google'
import './globals.css'
import './responsive-polish.css'
import './brand-refinements.css'
import './section02-brandbook.css'
import './theme-system-v2.css'
import './about-team.css'
import './navigation-client-fixes.css'
import './section07-brand-device.css'
import './theme-v3.css'

import SmoothScroll from '@/components/smooth-scroll'
import ScrollProgress from '@/components/scroll-progress'
import SiteNav from '@/components/site-nav'
import SiteFooter from '@/components/site-footer'
import { WhatsappFloat } from '@/components/whatsapp-cta'
import SiteInteractionTracker from '@/components/site-interaction-tracker'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site'
import { displayFont } from '@/lib/display-font'
import StructuredData from '@/components/structured-data'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const interTight = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter-tight',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Agência Cassiellos' }],
  keywords: [
    'agência de marketing em Belo Horizonte',
    'agência de marketing BH',
    'agência de marketing digital',
    'marketing digital Belo Horizonte',
    'agência de publicidade Belo Horizonte',
    'gestão de redes sociais',
    'tráfego pago',
    'branding',
    'criação de sites',
    'produção de vídeo',
    'agência de marketing Brasil',
  ],
  category: 'marketing',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  other: {
    'geo.region': 'BR-MG',
    'geo.placename': 'Belo Horizonte',
  },
  alternates: { canonical: '/', languages: { 'pt-BR': '/', en: '/en' } },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  themeColor: '#07101F',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${interTight.variable} ${displayFont.variable}`}>
      <head>
        <StructuredData />
        {/* Sem JS as animações não rodam: o conteúdo precisa aparecer mesmo assim. */}
        <noscript>
          <style>{`[style*="opacity:0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <SmoothScroll />
        <ScrollProgress />
        <SiteNav />
        {children}
        <SiteFooter />
        <WhatsappFloat />
        <Analytics />
        <SiteInteractionTracker />
        <SpeedInsights />
      </body>
    </html>
  )
}
