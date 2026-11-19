import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { readEmailConfig } from '@/lib/crm/comms/config'
import { sweepDueMessages } from '@/lib/crm/comms/send'

/**
 * Varredura dos envios que não couberam no agendamento nativo da Resend (reuniões marcadas com
 * mais de 30 dias de antecedência). Pensada para o Vercel Cron, que chama com
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Sem CRON_SECRET: 404. Sem a Resend ligada: não faz nada.
 * Rodar duas vezes é seguro — a reserva de cada linha é um UPDATE condicional e a Resend ainda
 * recebe a mesma Idempotency-Key.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const json = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } })

/** Comparação em tempo constante: o tempo de resposta não deve revelar o prefixo correto. */
function authorized(header: string | null, secret: string): boolean {
  const offered = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(offered)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function run(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return json({ error: 'NOT_FOUND' }, 404)
  if (!authorized(request.headers.get('authorization'), secret)) return json({ error: 'FORBIDDEN' }, 403)

  const config = readEmailConfig()
  if (!config.ready) return json({ ok: true, skipped: 'EMAIL_DISABLED', issues: config.issues }, 200)

  try {
    const result = await sweepDueMessages({
      pool: getCrmPool(), config, fetch: (url, init) => fetch(url, init),
    })
    console.info(JSON.stringify({ scope: 'comms_email', event: 'sweep', ...result }))
    return json({ ok: true, ...result }, 200)
  } catch {
    return json({ error: 'SWEEP_FAILED' }, 503)
  }
}

export const GET = run
export const POST = run
