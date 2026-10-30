import { NextRequest, NextResponse } from 'next/server'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { validReceipt } from '@/lib/crm/push/messages'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { recordReceipt } from '@/lib/crm/push/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recibo do service worker (notificação EXIBIDA ou TOCADA). Funciona mesmo com a sessão expirada,
 * mas só com o token HMAC da própria entrega; não devolve nenhum dado. Origem do próprio CRM.
 */
export async function POST(req: NextRequest) {
  const none = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  if (process.env.VERCEL_ENV !== 'preview') return new NextResponse(null, { status: 404 })
  if (!isCrmPreviewOrigin(req.headers.get('origin'))) return new NextResponse(null, { status: 403 })
  let data: { d?: unknown; r?: unknown; e?: unknown }
  try {
    const raw = await req.text()
    if (raw.length > 300) return none
    data = JSON.parse(raw)
  } catch { return none }
  if (data?.e !== 'displayed' && data?.e !== 'clicked') return none
  if (!validReceipt(process.env.CRM_SESSION_SECRET, data.d, data.r)) return none
  await recordReceipt(pushRuntimeDeps().pool, data.d, data.e).catch(() => false)
  return none
}
