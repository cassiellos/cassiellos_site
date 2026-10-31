import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'CRM | Cassiellos',
  description: 'Painel de relacionamento e conversões da Cassiellos.',
  robots: { index: false, follow: false, nocache: true },
  // PWA CRM Cassiellos: somente nas rotas administrativas (/crm). Páginas públicas não recebem o manifesto.
  manifest: '/crm/manifest.webmanifest',
  applicationName: 'CRM | Cassiellos',
  appleWebApp: { capable: true, title: 'CRM | Cassiellos', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: '/crm/icon/192.png?v=3', sizes: '192x192', type: 'image/png' }, { url: '/crm/icon/512.png?v=3', sizes: '512x512', type: 'image/png' }], shortcut: [{ url: '/crm/icon/192.png?v=3', type: 'image/png' }], apple: [{ url: '/crm/icon/apple.png?v=3', sizes: '180x180', type: 'image/png' }] },
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
