import { isIP } from 'node:net'
import { HOMOLOGATION_ACTIVITY } from './meta-homologation-claims'
import { readMarketingConsentState } from './marketing-consent'
import { buildMetaServerEvent, formatMetaServerEvent, type MetaServerEvent, type TrackingEventRow } from './meta-events'

/**
 * Meta Conversions API — envio do evento padrão `Schedule` pelo servidor (DESLIGADO por padrão).
 *
 * Regras (missão 03/11/2026, issue #26):
 * - uma reunião confirmada = um Schedule: mesmo event_name e o MESMO event_id do Pixel
 *   (`chronos_scheduled_<bookingId>`), idempotência pela fila crm.meta_deliveries (UNIQUE por evento);
 * - roda DEPOIS da resposta da confirmação (`after()`): falha, lentidão ou indisponibilidade da Meta nunca
 *   impede nem desfaz a reunião já criada no Google Calendar;
 * - travas checadas no momento do envio (e antes de cada nova tentativa): modo ligado, lead REAL
 *   (tracking metadata.isTest === false e crm.leads.is_test === false), reunião ainda `confirmed`,
 *   consentimento de marketing VIGENTE (readMarketingConsentState) e evento com até 7 dias;
 * - homologação: somente lead de TESTE com reserva de homologação do Schedule registrada no banco e
 *   META_CAPI_TEST_EVENT_CODE definido — o envio sempre leva test_event_code; nunca no fluxo comercial;
 * - dados de correspondência: SOMENTE o user agent (exigido pela Meta para eventos de site) e o IP da
 *   própria requisição de confirmação, usados em memória e NUNCA gravados. Sem e-mail, telefone, nome,
 *   fbp/fbc ou fbclid (decisões C2/G2 preservadas);
 * - token só no servidor (META_CAPI_ACCESS_TOKEN), enviado no corpo do POST — nunca na URL, em logs ou
 *   na fila. Registros de status sem segredos e sem dados pessoais.
 */

export type CapiMode = 'off' | 'test' | 'live'

export type CapiConfig =
  | { mode: 'off'; reason: 'disabled' | 'missing_pixel' | 'missing_token' | 'invalid_version' }
  | { mode: 'test' | 'live'; pixelId: string; accessToken: string; apiVersion: string; testEventCode: string | null }

/** Versão do Graph API (v26.0 é a mais recente em 03/11/2026; a CAPI mantém cada versão por pelo menos 2 anos). */
export const DEFAULT_GRAPH_API_VERSION = 'v26.0'
export const CAPI_MAX_ATTEMPTS = 3
/** Espera antes da 2ª e da 3ª tentativa (dentro da mesma execução; maxDuration da rota = 60 s). */
export const CAPI_RETRY_DELAYS_MS = [2_000, 6_000] as const
export const CAPI_TIMEOUT_MS = 8_000
const MAX_EVENT_AGE_S = 7 * 86_400

/**
 * Modo da CAPI. Só os valores literais `test` ou `live` ligam o envio; ausente, vazio ou qualquer
 * outro valor = OFF. Sem token ou sem ID do Pixel/dataset válido = OFF (falha fechada).
 */
export function readCapiConfig(env: Record<string, string | undefined> = process.env): CapiConfig {
  const raw = env.META_CAPI_MODE?.trim()
  if (raw !== 'test' && raw !== 'live') return { mode: 'off', reason: 'disabled' }
  const pixelId = env.META_PIXEL_ID?.trim() || ''
  if (!/^\d{10,20}$/.test(pixelId)) return { mode: 'off', reason: 'missing_pixel' }
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim() || ''
  if (accessToken.length < 20 || accessToken.length > 1_000 || /\s/.test(accessToken)) return { mode: 'off', reason: 'missing_token' }
  const apiVersion = env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION
  if (!/^v\d{2,3}\.0$/.test(apiVersion)) return { mode: 'off', reason: 'invalid_version' }
  const code = env.META_CAPI_TEST_EVENT_CODE?.trim() || ''
  const testEventCode = /^[A-Za-z0-9_-]{4,40}$/.test(code) ? code : null
  return { mode: raw, pixelId, accessToken, apiVersion, testEventCode }
}

/** IP público do visitante informado pela Vercel. Inválido ou ausente = não enviado (o IP é opcional). */
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const candidates = [headers.get('x-real-ip'), headers.get('x-forwarded-for')?.split(',')[0]]
  for (const raw of candidates) {
    const value = raw?.trim() ?? ''
    if (value && value.length <= 45 && isIP(value)) return value
  }
  return null
}

/** User agent do navegador (exigido pela Meta para eventos de site). Ausente ou anômalo = nada é enviado. */
export function clientUserAgentFrom(headers: { get(name: string): string | null }): string | null {
  const value = headers.get('user-agent')?.trim() ?? ''
  return value.length >= 8 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}

/** Contexto lido do banco no momento do envio (nada pessoal: só marcas, status e o evento interno). */
export type ScheduleContext = TrackingEventRow & {
  trackingId: string
  leadId: string
  leadIsTest: boolean | null
  appointmentStatus: string | null
  homologationClaimed: boolean
}

/** Estado que pode mudar entre tentativas: reunião ainda confirmada e consentimento vigente. */
export type ScheduleGate = { appointmentStatus: string | null; consentGranted: boolean }

export type DeliveryUpdate = {
  status: 'retry' | 'accepted' | 'rejected' | 'abandoned'
  httpStatus: number | null
  error: string | null
  nextAttemptInMs?: number
  /** Só fbtrace_id e quantidade recebida — sem dados enviados. */
  response?: { fbtrace_id?: string; events_received?: number }
}

export interface CapiStore {
  loadContext(eventId: string): Promise<ScheduleContext | null>
  readGate(ctx: ScheduleContext): Promise<ScheduleGate>
  /** Cria a linha da fila. null = esse evento já foi enfileirado/enviado antes (idempotência). */
  claimDelivery(trackingId: string, payload: Record<string, unknown>): Promise<string | null>
  markAttempt(deliveryId: string): Promise<void>
  finish(deliveryId: string, update: DeliveryUpdate): Promise<void>
}

export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ status: number; json(): Promise<unknown> }>

export type CapiLog = (entry: {
  scope: 'meta_capi'; event: 'Schedule'; outcome: string; route?: 'live' | 'homologation'
  httpStatus?: number | null; attempts?: number; delivery?: string
}) => void

export type CapiDeps = {
  config: CapiConfig
  store: CapiStore
  fetch: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: CapiLog
}

export type CapiOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'duplicate' }
  | { status: 'accepted' | 'rejected' | 'abandoned'; attempts: number; httpStatus: number | null; error?: string | null }

type Route = { route: 'live'; payload: MetaServerEvent } | { route: 'homologation'; payload: MetaServerEvent; testEventCode: string }

/** Decide se este Schedule pode sair e por qual rota. Nenhum outro caso envia nada. */
export function decideScheduleRoute(
  config: CapiConfig, ctx: ScheduleContext, gate: ScheduleGate, nowMs: number,
): Route | { route: null; reason: string } {
  if (config.mode === 'off') return { route: null, reason: 'disabled' }
  if (ctx.event_name !== 'Chronos_Scheduled') return { route: null, reason: 'unmapped_event' }
  if (gate.appointmentStatus !== 'confirmed') return { route: null, reason: 'appointment_not_confirmed' }
  if (gate.consentGranted !== true) return { route: null, reason: 'no_marketing_consent' }
  const occurred = new Date(ctx.occurred_at).getTime()
  if (!Number.isFinite(occurred) || nowMs / 1000 - occurred / 1000 > MAX_EVENT_AGE_S) return { route: null, reason: 'stale_event' }
  const metadata = ctx.metadata && typeof ctx.metadata === 'object' ? ctx.metadata as { isTest?: unknown } : {}

  // Lead REAL: marca explícita no evento e no lead. Nunca com test_event_code.
  if (metadata.isTest === false && ctx.leadIsTest === false) {
    if (config.mode !== 'live') return { route: null, reason: 'live_disabled' }
    const decision = buildMetaServerEvent(ctx, { granted: gate.consentGranted })
    return decision.allowed ? { route: 'live', payload: decision.payload } : { route: null, reason: decision.reason }
  }
  // Homologação: lead de TESTE + reserva do Schedule da liberação + código de teste. Sempre test_event_code.
  if (metadata.isTest === true && ctx.leadIsTest === true && ctx.homologationClaimed) {
    if (!config.testEventCode) return { route: null, reason: 'missing_test_event_code' }
    const payload = formatMetaServerEvent(ctx)
    if (!payload) return { route: null, reason: 'invalid_event' }
    return {
      route: 'homologation', testEventCode: config.testEventCode,
      payload: { ...payload, custom_data: { ...payload.custom_data, cassiellos_teste: 'homologacao' } },
    }
  }
  return { route: null, reason: 'test_or_unclassified' }
}

/** Corpo do POST (application/x-www-form-urlencoded): `data`, `access_token` e, na homologação, `test_event_code`. */
export function buildRequestBody(
  event: MetaServerEvent, client: { ip: string | null; userAgent: string }, accessToken: string, testEventCode: string | null,
): string {
  const wire = {
    ...event,
    user_data: {
      ...event.user_data,
      client_user_agent: client.userAgent,
      ...(client.ip ? { client_ip_address: client.ip } : {}),
    },
  }
  const form = new URLSearchParams()
  form.set('data', JSON.stringify([wire]))
  if (testEventCode) form.set('test_event_code', testEventCode)
  form.set('access_token', accessToken)
  return form.toString()
}

/** Cópia gravada na fila: SEM IP, user agent ou token (apenas quais campos de correspondência foram usados). */
export function storedPayload(route: Route, apiVersion: string, client: { ip: string | null }): Record<string, unknown> {
  const { user_data: _notStored, ...event } = route.payload
  return {
    route: route.route,
    apiVersion,
    testEventCode: route.route === 'homologation',
    event,
    userDataFields: ['client_user_agent', ...(client.ip ? ['client_ip_address'] : [])],
  }
}

/** Erros temporários: 429, 5xx, timeout/rede ou erro Graph marcado como transitório / limite de uso. */
const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 341, 613])

function graphError(body: unknown): { code: number | null; subcode: number | null; transient: boolean } {
  const err = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null
  if (!err || typeof err !== 'object') return { code: null, subcode: null, transient: false }
  const e = err as { code?: unknown; error_subcode?: unknown; is_transient?: unknown }
  const code = Number.isInteger(e.code) ? e.code as number : null
  const subcode = Number.isInteger(e.error_subcode) ? e.error_subcode as number : null
  return { code, subcode, transient: e.is_transient === true || (code !== null && TRANSIENT_GRAPH_CODES.has(code)) }
}

const sanitizedError = (prefix: string, code: number | null, subcode: number | null) =>
  prefix + (code === null ? '' : ':' + code) + (subcode === null ? '' : '/' + subcode)

/**
 * Envia (no máximo uma vez por reunião) o Schedule de servidor. Nunca lança erro: qualquer falha vira
 * status na fila e um log sem dados pessoais. Chamado somente via `after()` na rota de confirmação.
 */
export async function dispatchScheduleToMeta(
  deps: CapiDeps, input: { eventId: string; clientIp: string | null; userAgent: string | null },
): Promise<CapiOutcome> {
  const log: CapiLog = deps.log ?? (() => undefined)
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const skip = (reason: string): CapiOutcome => {
    log({ scope: 'meta_capi', event: 'Schedule', outcome: 'skipped:' + reason })
    return { status: 'skipped', reason }
  }
  const config = deps.config
  if (config.mode === 'off') return { status: 'skipped', reason: config.reason }
  if (typeof input.eventId !== 'string' || !/^chronos_scheduled_[a-f0-9]{32}$/.test(input.eventId)) return skip('invalid_event')
  if (!input.userAgent) return skip('missing_user_agent')
  const client = { ip: input.clientIp, userAgent: input.userAgent }

  let deliveryId: string | null = null
  let attempts = 0
  try {
    const ctx = await deps.store.loadContext(input.eventId)
    if (!ctx) return skip('event_not_found')
    let route = decideScheduleRoute(config, ctx, await deps.store.readGate(ctx), now())
    if (route.route === null) return skip(route.reason)

    deliveryId = await deps.store.claimDelivery(ctx.trackingId, storedPayload(route, config.apiVersion, client))
    if (!deliveryId) {
      log({ scope: 'meta_capi', event: 'Schedule', outcome: 'duplicate', route: route.route })
      return { status: 'duplicate' }
    }
    const url = 'https://graph.facebook.com/' + config.apiVersion + '/' + config.pixelId + '/events'

    let lastStatus: number | null = null
    let lastError: string | null = null
    while (attempts < CAPI_MAX_ATTEMPTS) {
      if (attempts > 0) {
        // Revalida antes de cada nova tentativa: revogação ou cancelamento interrompem o envio.
        const again = decideScheduleRoute(config, ctx, await deps.store.readGate(ctx), now())
        if (again.route === null) {
          await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: lastStatus, error: 'stopped:' + again.reason })
          log({ scope: 'meta_capi', event: 'Schedule', outcome: 'abandoned:' + again.reason, route: route.route, attempts, delivery: deliveryId })
          return { status: 'abandoned', attempts, httpStatus: lastStatus, error: 'stopped:' + again.reason }
        }
        route = again
      }
      attempts += 1
      await deps.store.markAttempt(deliveryId)
      const body = buildRequestBody(route.payload, client, config.accessToken,
        route.route === 'homologation' ? route.testEventCode : null)
      let transient = false
      try {
        const response = await deps.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body, signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
        })
        lastStatus = response.status
        const json: unknown = await response.json().catch(() => null)
        if (response.status >= 200 && response.status < 300) {
          const received = json && typeof json === 'object' ? (json as { events_received?: unknown }).events_received : undefined
          const trace = json && typeof json === 'object' ? (json as { fbtrace_id?: unknown }).fbtrace_id : undefined
          const responseInfo = {
            ...(typeof trace === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(trace) ? { fbtrace_id: trace } : {}),
            ...(typeof received === 'number' ? { events_received: received } : {}),
          }
          if (received === 1) {
            await deps.store.finish(deliveryId, { status: 'accepted', httpStatus: response.status, error: null, response: responseInfo })
            log({ scope: 'meta_capi', event: 'Schedule', outcome: 'accepted', route: route.route, httpStatus: response.status, attempts, delivery: deliveryId })
            return { status: 'accepted', attempts, httpStatus: response.status }
          }
          await deps.store.finish(deliveryId, { status: 'rejected', httpStatus: response.status, error: 'no_events_received', response: responseInfo })
          log({ scope: 'meta_capi', event: 'Schedule', outcome: 'rejected:no_events_received', route: route.route, httpStatus: response.status, attempts, delivery: deliveryId })
          return { status: 'rejected', attempts, httpStatus: response.status, error: 'no_events_received' }
        }
        const g = graphError(json)
        lastError = sanitizedError('http_' + response.status, g.code, g.subcode)
        transient = response.status === 429 || response.status >= 500 || g.transient
        if (!transient) {
          await deps.store.finish(deliveryId, { status: 'rejected', httpStatus: response.status, error: lastError })
          log({ scope: 'meta_capi', event: 'Schedule', outcome: 'rejected', route: route.route, httpStatus: response.status, attempts, delivery: deliveryId })
          return { status: 'rejected', attempts, httpStatus: response.status, error: lastError }
        }
      } catch (error) {
        // Timeout ou rede: tentativa incerta. Reenviar é seguro porque a Meta deduplica pelo mesmo event_id.
        transient = true
        lastStatus = null
        lastError = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network_error'
      }
      if (transient && attempts < CAPI_MAX_ATTEMPTS) {
        const wait = CAPI_RETRY_DELAYS_MS[attempts - 1] ?? CAPI_RETRY_DELAYS_MS[CAPI_RETRY_DELAYS_MS.length - 1]
        await deps.store.finish(deliveryId, { status: 'retry', httpStatus: lastStatus, error: lastError, nextAttemptInMs: wait })
        log({ scope: 'meta_capi', event: 'Schedule', outcome: 'retry:' + lastError, route: route.route, httpStatus: lastStatus, attempts, delivery: deliveryId })
        await sleep(wait)
      }
    }
    // Sem reprocessamento posterior: o user agent/IP não são gravados (exigiria nova decisão de dados).
    await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: lastStatus, error: lastError })
    log({ scope: 'meta_capi', event: 'Schedule', outcome: 'abandoned:' + lastError, route: route.route, httpStatus: lastStatus, attempts, delivery: deliveryId })
    return { status: 'abandoned', attempts, httpStatus: lastStatus, error: lastError }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown'
    if (deliveryId) {
      await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: null, error: 'internal_error' }).catch(() => undefined)
    }
    log({ scope: 'meta_capi', event: 'Schedule', outcome: 'error:' + name, attempts, ...(deliveryId ? { delivery: deliveryId } : {}) })
    return { status: 'abandoned', attempts, httpStatus: null, error: 'internal_error' }
  }
}

type Queryable = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

/** Implementação PostgreSQL (crm.tracking_events + crm.meta_deliveries). Sem dados pessoais nas consultas. */
export function pgCapiStore(db: Queryable): CapiStore {
  return {
    async loadContext(eventId) {
      const { rows } = await db.query<{
        id: string; event_id: string; event_name: string; occurred_at: Date; event_source_url: string | null
        metadata: unknown; lead_id: string; lead_is_test: boolean | null; appointment_status: string | null; claimed: boolean
      }>(
        `SELECT t.id, t.event_id, t.event_name, t.occurred_at, t.event_source_url, t.metadata, t.lead_id,
                l.is_test AS lead_is_test, a.status AS appointment_status,
                EXISTS (SELECT 1 FROM crm.lead_activities la
                         WHERE la.lead_id = t.lead_id AND la.activity_kind = $2
                           AND la.details->>'event' = 'Schedule' AND la.details->>'eventId' = t.event_id) AS claimed
           FROM crm.tracking_events t
           JOIN crm.leads l ON l.id = t.lead_id
           LEFT JOIN crm.appointments a ON a.id = t.appointment_id
          WHERE t.event_id = $1 AND t.event_name = 'Chronos_Scheduled'`,
        [eventId, HOMOLOGATION_ACTIVITY],
      )
      const row = rows[0]
      if (!row) return null
      return {
        trackingId: row.id, event_id: row.event_id, event_name: row.event_name, occurred_at: row.occurred_at,
        event_source_url: row.event_source_url, metadata: row.metadata, leadId: row.lead_id,
        leadIsTest: row.lead_is_test, appointmentStatus: row.appointment_status, homologationClaimed: row.claimed === true,
      }
    },
    async readGate(ctx) {
      const { rows } = await db.query<{ status: string | null }>(
        `SELECT a.status FROM crm.tracking_events t LEFT JOIN crm.appointments a ON a.id = t.appointment_id WHERE t.id = $1`,
        [ctx.trackingId],
      )
      const consent = await readMarketingConsentState(db as Parameters<typeof readMarketingConsentState>[0], ctx.leadId)
      return { appointmentStatus: rows[0]?.status ?? null, consentGranted: consent.granted }
    },
    async claimDelivery(trackingId, payload) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO crm.meta_deliveries (tracking_event_id, payload, status)
         VALUES ($1, $2::jsonb, 'pending')
         ON CONFLICT (tracking_event_id) DO NOTHING
         RETURNING id`,
        [trackingId, JSON.stringify(payload)],
      )
      return rows[0]?.id ?? null
    },
    async markAttempt(deliveryId) {
      await db.query(
        `UPDATE crm.meta_deliveries SET attempts = attempts + 1, last_attempt_at = now(), updated_at = now() WHERE id = $1`,
        [deliveryId],
      )
    },
    async finish(deliveryId, update) {
      await db.query(
        `UPDATE crm.meta_deliveries
            SET status = $2, last_http_status = $3, last_error = $4,
                next_attempt_at = now() + make_interval(secs => $5::double precision / 1000),
                accepted_at = CASE WHEN $2 = 'accepted' THEN now() ELSE accepted_at END,
                payload = CASE WHEN $6::jsonb IS NULL THEN payload ELSE payload || jsonb_build_object('response', $6::jsonb) END,
                updated_at = now()
          WHERE id = $1`,
        [deliveryId, update.status, update.httpStatus, update.error?.slice(0, 120) ?? null,
          update.nextAttemptInMs ?? 0, update.response ? JSON.stringify(update.response) : null],
      )
    },
  }
}
