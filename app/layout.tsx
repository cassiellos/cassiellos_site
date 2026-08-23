import type { Metadata, Viewport } from 'next'
import { Inter, Inter_Tight } from 'next/font/google'
import './globals.css'
import './responsive-polish.css'
import './brand-refinements.css'
import './section02-brandbook.css'
import './theme-system-v2.css'

import SmoothScroll from '@/components/smooth-scroll'
import ScrollProgress from '@/components/scroll-progress'
import SiteNav from '@/components/site-nav'
import SiteFooter from '@/components/site-footer'
import { LeviProvider } from '@/components/levi-provider'
import LeviWidget from '@/components/levi-widget'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site'

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
    'operações criativas',
    'estratégia de marca',
    'conteúdo',
    'cassiellOS',
    'agência de marketing',
  ],
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
    <html lang="pt-BR" className={`${inter.variable} ${interTight.variable}`}>
      <head>
        {/* Sem JS as animações não rodam: o conteúdo precisa aparecer mesmo assim. */}
        <noscript>
          <style>{`[style*="opacity:0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <LeviProvider>
          <SmoothScroll />
          <ScrollProgress />
          <SiteNav />
          {children}
          <SiteFooter />
          <LeviWidget />
        </LeviProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
