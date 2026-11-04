import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

export const metadata: Metadata = {
  title: 'CRM',
  description: 'Painel de relacionamento e conversões da Cassiellos.',
  robots: { index: false, follow: false, nocache: true },
  // PWA CRM Cassiellos: somente nas rotas administrativas (/crm). Páginas públicas não recebem o manifesto.
  manifest: '/crm/manifest.webmanifest',
  applicationName: 'CRM',
  appleWebApp: { capable: true, title: 'CRM', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: '/crm/icon/192.png?v=3', sizes: '192x192', type: 'image/png' }, { url: '/crm/icon/512.png?v=3', sizes: '512x512', type: 'image/png' }], shortcut: [{ url: '/crm/icon/192.png?v=3', type: 'image/png' }], apple: [{ url: '/crm/icon/apple.png?v=3', sizes: '180x180', type: 'image/png' }] },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = { themeColor: '#07101F', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  // A interface CRM só existe nos ambientes autorizados (lib/crm/runtime-env.ts) ou em desenvolvimento local.
  if (!isCrmRuntimeEnabled() && process.env.NODE_ENV === 'production') {
    notFound()
  }
  return children
}
