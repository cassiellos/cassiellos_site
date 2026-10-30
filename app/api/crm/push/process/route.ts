import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { sweepPushQueue } from '@/lib/crm/push/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Reprocessamento da fila por um agendador EXTERNO (opcional, para o futuro). Desligado enquanto
 * CRM_PUSH_PROCESS_SECRET não existir. A Vercel não executa Cron em deploys Preview; em Production,
 * um Cron da Vercel poderia chamar esta rota com "Authorization: Bearer <segredo>".
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRM_PUSH_PROCESS_SECRET?.trim()
  if (process.env.VERCEL_ENV !== 'preview' || !secret || secret.length < 32) return new NextResponse(null, { status: 404 })
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from('Bearer ' + secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new NextResponse(null, { status: 401 })
  const processed = await sweepPushQueue(pushRuntimeDeps(), { limit: 20 }).catch(() => -1)
  return NextResponse.json({ ok: processed >= 0, processed }, { headers: { 'Cache-Control': 'no-store' } })
}
