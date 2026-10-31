import { ImageResponse } from 'next/og'
import { cassiellosCrmIconSvg, type CassiellosIconVariant } from '@/lib/crm/cassiellos-icon'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ICONS: Record<string, { size: number; variant: CassiellosIconVariant }> = {
  '192.png': { size: 192, variant: 'full' },
  '512.png': { size: 512, variant: 'full' },
  'apple.png': { size: 180, variant: 'full' },
  'maskable.png': { size: 512, variant: 'maskable' },
  'badge.png': { size: 96, variant: 'badge' },
}

/** Ícones PNG com a geometria exata da marca oficial, com a palavra CRM abaixo.
 * Usar URLs versionadas em manifesto/metadata: evita cache antigo no iPhone.
 * A rota não consulta banco, cookies ou chaves de ambiente.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ variant: string }> },
) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 })
  }
  const { variant } = await context.params
  const option = ICONS[variant]
  if (!option) return new Response(null, { status: 404 })

  const svg = cassiellosCrmIconSvg(option.variant)
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} alt="" width={option.size} height={option.size}
        style={{ width: option.size, height: option.size }} />
    </div>,
    {
      width: option.size,
      height: option.size,
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Robots-Tag': 'noindex',
      },
    },
  )
}
