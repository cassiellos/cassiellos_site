import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

/**
 * PWA do CRM Cassiellos — SOMENTE a área administrativa (/crm). As páginas públicas (/agendar, site)
 * não referenciam este manifesto e não viram aplicativo.
 */
export function GET() {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') return new NextResponse(null, { status: 404 })
  return NextResponse.json({
    id: '/crm',
    name: 'CRM | Cassiellos',
    short_name: 'CRM | Cassiellos',
    description: 'Mini CRM da Cassiellos: leads, reuniões e avisos da equipe.',
    lang: 'pt-BR',
    start_url: '/crm',
    scope: '/crm',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#07101F',
    theme_color: '#07101F',
    icons: [
      { src: '/crm-icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/crm-icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/crm-icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' } })
}
