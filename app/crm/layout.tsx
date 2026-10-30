import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Mini CRM | Cassiellos',
  description: 'Painel de relacionamento e conversões da Cassiellos.',
  robots: { index: false, follow: false, nocache: true },
  // PWA SHARK SCALE: somente nas rotas administrativas (/crm). Páginas públicas não recebem o manifesto.
  manifest: '/crm/manifest.webmanifest',
  applicationName: 'SHARK SCALE',
  appleWebApp: { capable: true, title: 'SHARK SCALE', statusBarStyle: 'black-translucent' },
  icons: { apple: [{ url: '/crm-icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = { themeColor: '#07101F', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  // A interface CRM só pode existir no ambiente de preview durante o desenvolvimento.
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    notFound()
  }
  return children
}
