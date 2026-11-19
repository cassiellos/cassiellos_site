import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { readEmailConfig } from '@/lib/crm/comms/config'
import { sweepDueMessages } from '@/lib/crm/comms/send'

/**
 * Varredura dos envios que não couberam no agendamento nativo da Resend (reuniões marcadas com mais
 * de 30 dias de antecedência) e nova tentativa dos que falharam de forma retriável.
 *
 * Chamada por um agendador EXTERNO, com `Authorization: Bearer <COMMS_SWEEP_SECRET>` — a mesma
 * convenção já usada por /api/crm/push/process. O `vercel.json` é COMPARTILHADO pelos dois projetos
 * Vercel (site institucional e CRM), então declarar um Cron lá criaria um agendamento também no site
 * institucional, onde esta rota não existe para ser chamada. Por isso o agendamento fica fora do
 * repositório: um Cron criado no projeto cassiellos-crm, ou qualquer agendador que faça a chamada.
 *
 * Sem COMMS_SWEEP_SECRET (mínimo de 32 caracteres): 404. Sem a Resend ligada: não faz nada.
 * Rodar duas vezes é seguro — a reserva de cada linha é um UPDATE condicional e a Resend recebe a
 * mesma Idempotency-Key.
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
  const secret = process.env.COMMS_SWEEP_SECRET?.trim()
  if (!secret || secret.length < 32) return json({ error: 'NOT_FOUND' }, 404)
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
