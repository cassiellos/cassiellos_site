import { buildMetaServerEvent, type MetaServerEvent, type TrackingEventRow } from './meta-events'
import {
  buildRequestBody, clientIpFrom, clientUserAgentFrom, pgCapiStore, readCapiConfig, storedPayload,
  CAPI_MAX_ATTEMPTS, CAPI_RETRY_DELAYS_MS, CAPI_TIMEOUT_MS,
  type CapiConfig, type CapiOutcome, type CapiStore, type FetchLike,
} from './meta-capi'
import { readMarketingConsentState } from './marketing-consent'

/**
 * Lead da Meta Conversions API para os dois formulários públicos do CRM.
 * - Só leads novos REAIS, com consentimento vigente no banco no momento do envio.
 * - Mesmos event_name='Lead' e event_id do Pixel do navegador (deduplicação).
 * - Sem nome, email, telefone, fbclid, fbp ou fbc na Meta, fila ou logs.
 * - Até 3 tentativas após a resposta HTTP do formulário; falha não perde o lead.
 */
const LEAD_EVENT_ID = /^lead_[a-f0-9]{32}$/
const EVENT_MAX_AGE_MS = 7 * 86_400_000

export type LeadCapiContext = TrackingEventRow & {
  trackingId: string
  leadId: string
  leadIsTest: boolean | null
}
export type LeadCapiGate = { leadIsTest: boolean | null; consentGranted: boolean }
export type LeadCapiStore = Pick<CapiStore, 'claimDelivery' | 'markAttempt' | 'finish'> & {
  loadContext(eventId: string): Promise<LeadCapiContext | null>
  readGate(ctx: LeadCapiContext): Promise<LeadCapiGate>
}
export type LeadCapiDeps = {
  config: CapiConfig
  store: LeadCapiStore
  fetch: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (entry: { scope: 'meta_capi'; event: 'Lead'; outcome: string; httpStatus?: number | null; attempts?: number }) => void
}

export function decideLeadRoute(
  config: CapiConfig, ctx: LeadCapiContext, gate: LeadCapiGate, nowMs: number,
): { allowed: true; payload: MetaServerEvent } | { allowed: false; reason: string } {
  if (config.mode !== 'live') return { allowed: false, reason: 'live_disabled' }
  if (ctx.event_name !== 'Lead' || !LEAD_EVENT_ID.test(ctx.event_id)) return { allowed: false, reason: 'invalid_event' }
  if (ctx.leadIsTest !== false || gate.leadIsTest !== false) return { allowed: false, reason: 'test_or_unclassified' }
  if (!gate.consentGranted) return { allowed: false, reason: 'no_marketing_consent' }
  const occurredAt = new Date(ctx.occurred_at).getTime()
  if (!Number.isFinite(occurredAt) || occurredAt > nowMs + 300_000 || nowMs - occurredAt > EVENT_MAX_AGE_MS) {
    return { allowed: false, reason: 'stale_event' }
  }
  const decision = buildMetaServerEvent(ctx, { granted: gate.consentGranted })
  return decision.allowed ? { allowed: true, payload: decision.payload } : { allowed: false, reason: decision.reason }
}

export async function dispatchLeadToMeta(
  deps: LeadCapiDeps, input: { eventId: string; clientIp: string | null; userAgent: string | null },
): Promise<CapiOutcome> {
  const log = deps.log ?? (() => undefined)
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const skip = (reason: string): CapiOutcome => {
    log({ scope: 'meta_capi', event: 'Lead', outcome: 'skipped:' + reason })
    return { status: 'skipped', reason }
  }
  if (deps.config.mode !== 'live') return skip('live_disabled')
  if (!LEAD_EVENT_ID.test(input.eventId)) return skip('invalid_event')
  if (!input.userAgent) return skip('missing_user_agent')
  const config = deps.config
  const client = { ip: input.clientIp, userAgent: input.userAgent }
  let deliveryId: string | null = null
  let attempts = 0
  try {
    const ctx = await deps.store.loadContext(input.eventId)
    if (!ctx) return skip('event_not_found')
    let route = decideLeadRoute(config, ctx, await deps.store.readGate(ctx), now())
    if (!route.allowed) return skip(route.reason)
    deliveryId = await deps.store.claimDelivery(ctx.trackingId,
      storedPayload({ route: 'live', payload: route.payload }, config.apiVersion, client))
    if (!deliveryId) return { status: 'duplicate' }
    const url = 'https://graph.facebook.com/' + config.apiVersion + '/' + config.pixelId + '/events'
    let lastStatus: number | null = null
    let lastError: string | null = null
    for (attempts = 1; attempts <= CAPI_MAX_ATTEMPTS; attempts++) {
      if (attempts > 1) {
        route = decideLeadRoute(config, ctx, await deps.store.readGate(ctx), now())
        if (!route.allowed) {
          await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: lastStatus, error: 'stopped:' + route.reason })
          return { status: 'abandoned', attempts: attempts - 1, httpStatus: lastStatus, error: 'stopped:' + route.reason }
        }
      }
      await deps.store.markAttempt(deliveryId)
      let transient = false
      try {
        const response = await deps.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: buildRequestBody(route.payload, client, config.accessToken, null),
          signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
        })
        lastStatus = response.status
        const json: unknown = await response.json().catch(() => null)
        const received = json && typeof json === 'object' ? (json as { events_received?: unknown }).events_received : null
        if (response.status >= 200 && response.status < 300 && received === 1) {
          await deps.store.finish(deliveryId, { status: 'accepted', httpStatus: response.status, error: null })
          log({ scope: 'meta_capi', event: 'Lead', outcome: 'accepted', httpStatus: response.status, attempts })
          return { status: 'accepted', attempts, httpStatus: response.status }
        }
        const graphError = json && typeof json === 'object' && 'error' in json
          ? (json as { error?: { code?: number; is_transient?: boolean } }).error : null
        transient = response.status === 429 || response.status >= 500 ||
          graphError?.is_transient === true ||
          [1, 2, 4, 17, 32, 341, 613].includes(graphError?.code ?? -1)
        lastError = response.status < 300 ? 'no_events_received' : 'http_' + response.status
        if (!transient) {
          await deps.store.finish(deliveryId, { status: 'rejected', httpStatus: response.status, error: lastError })
          log({ scope: 'meta_capi', event: 'Lead', outcome: 'rejected', httpStatus: response.status, attempts })
          return { status: 'rejected', attempts, httpStatus: response.status, error: lastError }
        }
      } catch (error) {
        transient = true
        lastStatus = null
        lastError = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network_error'
      }
      if (transient && attempts < CAPI_MAX_ATTEMPTS) {
        const wait = CAPI_RETRY_DELAYS_MS[attempts - 1] ?? 6_000
        await deps.store.finish(deliveryId, { status: 'retry', httpStatus: lastStatus, error: lastError, nextAttemptInMs: wait })
        await sleep(wait)
      }
    }
    await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: lastStatus, error: lastError })
    log({ scope: 'meta_capi', event: 'Lead', outcome: 'abandoned', httpStatus: lastStatus, attempts: CAPI_MAX_ATTEMPTS })
    return { status: 'abandoned', attempts: CAPI_MAX_ATTEMPTS, httpStatus: lastStatus, error: lastError }
  } catch {
    if (deliveryId) {
      await deps.store.finish(deliveryId, { status: 'abandoned', httpStatus: null, error: 'internal_error' }).catch(() => undefined)
    }
    log({ scope: 'meta_capi', event: 'Lead', outcome: 'error', attempts })
    return { status: 'abandoned', attempts, httpStatus: null, error: 'internal_error' }
  }
}

type Queryable = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
export function pgLeadCapiStore(db: Queryable): LeadCapiStore {
  const deliveries = pgCapiStore(db)
  return {
    async loadContext(eventId) {
      const result = await db.query<{
        id: string; event_id: string; event_name: string; occurred_at: Date;
        event_source_url: string | null; metadata: unknown; lead_id: string; lead_is_test: boolean
      }>(
        `SELECT t.id,t.event_id,t.event_name,t.occurred_at,t.event_source_url,t.metadata,
                t.lead_id,l.is_test AS lead_is_test
           FROM crm.tracking_events t
           JOIN crm.leads l ON l.id=t.lead_id
          WHERE t.event_id=$1 AND t.event_name='Lead'`, [eventId])
      const r = result.rows[0]
      return r ? {
        trackingId: r.id, event_id: r.event_id, event_name: r.event_name,
        occurred_at: r.occurred_at, event_source_url: r.event_source_url, metadata: r.metadata,
        leadId: r.lead_id, leadIsTest: r.lead_is_test,
      } : null
    },
    async readGate(ctx) {
      const result = await db.query<{ is_test: boolean }>('SELECT is_test FROM crm.leads WHERE id=$1', [ctx.leadId])
      const consent = await readMarketingConsentState(db as Parameters<typeof readMarketingConsentState>[0], ctx.leadId)
      return { leadIsTest: result.rows[0]?.is_test ?? null, consentGranted: consent.granted }
    },
    claimDelivery: deliveries.claimDelivery,
    markAttempt: deliveries.markAttempt,
    finish: deliveries.finish,
  }
}

// Encapsula a leitura do request: nem o IP nem o user agent persistem no CRM.
export const metaLeadClientFromHeaders = (headers: { get(name: string): string | null }) => ({
  clientIp: clientIpFrom(headers), userAgent: clientUserAgentFrom(headers),
})
export const metaLeadConfig = readCapiConfig
