import type { FinancePool } from '../finance/store'
import { parseWebhookEvent, verifyWebhookToken } from './policy'
import { AsaasLinkError, processWebhookEvent, recordWebhookEvent, type ProcessResult, type ReconcileOptions } from './store'
import { AsaasDataError, type AsaasEnvironment, type AsaasReadGateway } from './types'

/**
 * Integração Asaas — FASE 2.2A: receptor de webhook PREPARADO, sem endpoint público.
 *
 * Não existe rota em app/ que chame este módulo; ele é exercitado apenas por testes locais. Quando houver rota
 * (fase futura, com autorização), ela só repassará método, cabeçalho asaas-access-token, content-type e corpo bruto.
 *
 * Ordem de verificação (nada toca o banco antes da autenticação):
 *   desativado → 404 | método ≠ POST → 405 | token inválido → 401 | content-type → 415 | tamanho → 413
 *   | JSON inválido → 400 | evento inválido → 400 | banco ligado a outro ambiente → 503
 *   | evento repetido → 200 (sem reprocessar) | novo → grava, processa e responde 200.
 * Uma falha de PROCESSAMENTO responde 200: o evento já está gravado como 'failed' e pode ser reprocessado
 * (reprocessPendingEvents). Isso evita que o Asaas reenvie em laço e pause a fila por um erro nosso.
 *
 * Registro mínimo: apenas tipo do evento, id do evento e resultado — nunca o corpo, nome, documento, e-mail ou
 * telefone do pagador. As respostas não ecoam o corpo recebido.
 */

export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

export type WebhookReceiverConfig = {
  environment: AsaasEnvironment
  /** Receptor ligado. Ausente/false = desativado (padrão): responde 404 sem ler nada. */
  enabled?: boolean
  /** Token configurado no Asaas (cabeçalho asaas-access-token). Mínimo de 32 caracteres. */
  expectedToken?: string | null
}

export type WebhookRequest = { method: string; token: string | null | undefined; contentType: string | null | undefined; rawBody: string }

export type WebhookLogEntry = { event: 'asaas_webhook'; outcome: string; eventType?: string; eventId?: string; status?: string; code?: string }

export type WebhookDeps = {
  pool: FinancePool
  actor?: string
  /** Leitor do Asaas (fonte da verdade). Sem ele, só eventos com data confiável são aplicados. */
  gateway?: AsaasReadGateway
  /** Processar logo após gravar (padrão: true). false = só grava; um job posterior reprocessa. */
  processInline?: boolean
  log?: (entry: WebhookLogEntry) => void
  reconcile?: ReconcileOptions
}

export type WebhookResponse = { status: number; body: Record<string, unknown> }

const reply = (status: number, body: Record<string, unknown>): WebhookResponse => ({ status, body })
const code = (e: unknown) => {
  const c = (e as { code?: unknown })?.code
  return typeof c === 'string' && /^[A-Z0-9_]{2,60}$/.test(c) ? c : 'UNEXPECTED_ERROR'
}

export async function handleAsaasWebhook(config: WebhookReceiverConfig, deps: WebhookDeps, req: WebhookRequest): Promise<WebhookResponse> {
  const log = deps.log ?? (() => undefined)
  if (config.enabled !== true) return reply(404, { error: 'NOT_FOUND' })
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' })
  if (!verifyWebhookToken(req.token, config.expectedToken)) {
    log({ event: 'asaas_webhook', outcome: 'unauthorized' })
    return reply(401, { error: 'UNAUTHORIZED' })
  }
  if (!/^application\/json(\s*;|$)/i.test(String(req.contentType ?? '').trim())) return reply(415, { error: 'UNSUPPORTED_MEDIA_TYPE' })
  if (typeof req.rawBody !== 'string' || Buffer.byteLength(req.rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) return reply(413, { error: 'PAYLOAD_TOO_LARGE' })
  let body: unknown
  try { body = JSON.parse(req.rawBody) } catch { return reply(400, { error: 'INVALID_JSON' }) }
  let ev
  try { ev = parseWebhookEvent(config.environment, body) } catch (e) {
    log({ event: 'asaas_webhook', outcome: 'invalid_event', code: code(e) })
    return reply(400, { error: e instanceof AsaasDataError ? e.code : 'INVALID_EVENT' })
  }
  let recorded
  try { recorded = await recordWebhookEvent(deps.pool, ev) } catch (e) {
    if (e instanceof AsaasLinkError && (e.code === 'ENVIRONMENT_MISMATCH' || e.code === 'ASAAS_ENVIRONMENT_NOT_BOUND')) {
      log({ event: 'asaas_webhook', outcome: 'environment_unavailable', code: e.code, eventType: ev.eventType })
      return reply(503, { error: 'RECEIVER_ENVIRONMENT_UNAVAILABLE' })
    }
    log({ event: 'asaas_webhook', outcome: 'store_failed', code: code(e), eventType: ev.eventType })
    return reply(500, { error: 'STORE_FAILED' })
  }
  if (recorded.duplicate) {
    log({ event: 'asaas_webhook', outcome: 'duplicate', eventType: ev.eventType, eventId: ev.eventId })
    return reply(200, { received: true, duplicate: true })
  }
  if (deps.processInline === false) {
    log({ event: 'asaas_webhook', outcome: 'queued', eventType: ev.eventType, eventId: ev.eventId })
    return reply(200, { received: true, status: 'pending' })
  }
  let result: ProcessResult
  try {
    result = await processWebhookEvent(deps.pool, recorded.id, deps.actor ?? 'asaas-webhook', deps.gateway, deps.reconcile)
  } catch (e) {
    result = { status: 'failed', error: code(e) }
  }
  log({ event: 'asaas_webhook', outcome: 'processed', eventType: ev.eventType, eventId: ev.eventId, status: result.status, code: result.error })
  return reply(200, { received: true, status: result.status })
}

export type ReprocessSummary = { attempted: number; byStatus: Record<string, number> }

/**
 * Reprocessa eventos gravados e não concluídos ('pending', 'failed', 'needs_resync') do ambiente, do mais antigo
 * para o mais novo, até `limit` eventos e somente os com menos de `maxAttempts` tentativas. Seguro para repetir:
 * processWebhookEvent é idempotente e serializado por cobrança.
 */
export async function reprocessPendingEvents(pool: FinancePool, environment: AsaasEnvironment, actor: string,
  opts: { gateway?: AsaasReadGateway; limit?: number; maxAttempts?: number; reconcile?: ReconcileOptions } = {}): Promise<ReprocessSummary> {
  if (opts.gateway && opts.gateway.environment !== environment) throw new AsaasLinkError('ENVIRONMENT_MISMATCH', 422)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  const maxAttempts = Math.min(Math.max(opts.maxAttempts ?? 10, 1), 100)
  const c = await pool.connect()
  let rows: { id: string }[]
  try {
    rows = (await c.query(`SELECT id FROM crm.finance_asaas_events WHERE environment = $1 AND status IN ('pending', 'failed', 'needs_resync')
      AND attempts < $2 ORDER BY received_at, id LIMIT $3`, [environment, maxAttempts, limit])).rows
  } finally { c.release() }
  const out: ReprocessSummary = { attempted: 0, byStatus: {} }
  for (const r of rows) {
    const res = await processWebhookEvent(pool, Number(r.id), actor, opts.gateway, opts.reconcile)
    out.attempted++
    out.byStatus[res.status] = (out.byStatus[res.status] ?? 0) + 1
  }
  return out
}
