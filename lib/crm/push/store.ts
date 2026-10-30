import type { Pool } from 'pg'
import { validateWhatsappTemplate, DEFAULT_WHATSAPP_TEMPLATE } from '../whatsapp-message'
import { buildPushPayload, type NotificationKind } from './messages'
import { b64url, pushHostOf, sendWebPush, type FetchLike, type PushOutcome, type VapidKeys } from './web-push'

/**
 * Fila persistente do Web Push administrativo (Etapa 5).
 *
 * - Um evento lógico por fato (chave única): lead_created:<lead>; meeting_confirmed:<reunião> (1) e
 *   meeting_whatsapp_ready:<reunião> (2). Refresh, reenvio do formulário e repetição da confirmação
 *   não geram novos avisos.
 * - Uma entrega por aviso e aparelho, com reserva atômica (UPDATE … RETURNING) e tentativas limitadas.
 *   Repetir é seguro: a notificação tem "tag" fixa e o aparelho substitui em vez de duplicar.
 * - Ordem: a entrega 2 de uma reunião só sai para um aparelho depois que a 1 foi ACEITA para ele.
 * - Nada retroativo: só eventos recentes entram; entregas vencem em 24 h; reunião cancelada cancela o aviso.
 * - Estados honestos: aceita pelo serviço de push (accepted_at) ≠ exibida (displayed_at, recibo do
 *   service worker) ≠ aberta (clicked_at / opened_at).
 * - Falha de push nunca desfaz lead, reunião ou evento do Google. Logs: só IDs da fila e códigos.
 */

export type Queryable = Pick<Pool, 'query'>

export type PushDeps = {
  pool: Queryable
  env: () => { ready: boolean; vapidReady: boolean; vapid: { keys: VapidKeys; subject: string } | null }
  fetch: FetchLike
  /** Segredo dos recibos (CRM_SESSION_SECRET). */
  secret: string | undefined
  sleep?: (ms: number) => Promise<void>
  log?: (event: string, details: Record<string, unknown>) => void
}

export const MAX_ATTEMPTS = 5
export const MAX_ACTIVE_DEVICES = 10
export const EVENT_WINDOW_MINUTES = 15
export const DELIVERY_EXPIRY_HOURS = 24
export const STALE_SENDING_MINUTES = 2
export const TEST_COOLDOWN_SECONDS = 30
const BACKOFF_SECONDS = [5, 15, 60, 300, 900]
/** Espera máxima para repetir ainda dentro da mesma execução (as rotas têm limite de duração). */
const INLINE_MAX_WAIT_SECONDS = 5

const defaultLog = (event: string, details: Record<string, unknown>) =>
  console.info(JSON.stringify({ scope: 'web_push', event, ...details }))

/* ------------------------------------------------------------- settings */

export type PushSettings = {
  notifyLeads: boolean
  notifyMeetings: boolean
  whatsappTemplate: string
  templateCustomized: boolean
  lastTestAt: string | null
}

/** null = migração 0010 ainda não aplicada neste banco. */
export async function loadPushSettings(pool: Queryable): Promise<PushSettings | null> {
  const exists = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('crm.push_settings') IS NOT NULL AND to_regclass('crm.push_subscriptions') IS NOT NULL
        AND to_regclass('crm.push_notifications') IS NOT NULL AND to_regclass('crm.push_deliveries') IS NOT NULL AS ok`)
  if (!exists.rows[0]?.ok) return null
  const row = (await pool.query<{ notify_leads: boolean; notify_meetings: boolean; whatsapp_template: string | null; last_test_at: Date | null }>(
    'SELECT notify_leads, notify_meetings, whatsapp_template, last_test_at FROM crm.push_settings WHERE id = 1')).rows[0]
  const checked = row?.whatsapp_template ? validateWhatsappTemplate(row.whatsapp_template) : null
  return {
    notifyLeads: row?.notify_leads !== false,
    notifyMeetings: row?.notify_meetings !== false,
    whatsappTemplate: checked?.ok ? checked.value : DEFAULT_WHATSAPP_TEMPLATE,
    templateCustomized: Boolean(checked?.ok),
    lastTestAt: row?.last_test_at ? new Date(row.last_test_at).toISOString() : null,
  }
}

export type SettingsChange =
  | { action: 'preferences'; notifyLeads: unknown; notifyMeetings: unknown }
  | { action: 'save_template'; template: unknown }
  | { action: 'restore_template' }

export async function changePushSettings(pool: Queryable, change: SettingsChange, actorRef: string):
  Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  if (!(await loadPushSettings(pool))) return { ok: false, error: 'MIGRATION_PENDING' }
  const by = 'crm_admin:' + actorRef.slice(0, 16)
  if (change.action === 'preferences') {
    if (typeof change.notifyLeads !== 'boolean' || typeof change.notifyMeetings !== 'boolean') return { ok: false, error: 'INVALID_REQUEST' }
    await pool.query(
      `INSERT INTO crm.push_settings (id, notify_leads, notify_meetings, updated_by, updated_at) VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET notify_leads = $1, notify_meetings = $2, updated_by = $3, updated_at = now()`,
      [change.notifyLeads, change.notifyMeetings, by])
    return { ok: true }
  }
  if (change.action === 'restore_template') {
    await pool.query(`UPDATE crm.push_settings SET whatsapp_template = NULL, updated_by = $1, updated_at = now() WHERE id = 1`, [by])
    return { ok: true }
  }
  const checked = validateWhatsappTemplate(change.template)
  if (!checked.ok) return { ok: false, error: checked.error, detail: checked.detail }
  await pool.query(`UPDATE crm.push_settings SET whatsapp_template = $1, updated_by = $2, updated_at = now() WHERE id = 1`,
    [checked.value === DEFAULT_WHATSAPP_TEMPLATE ? null : checked.value, by])
  return { ok: true }
}

/* -------------------------------------------------------------- devices */

export type DeviceRow = {
  id: string; label: string; pushHost: string; status: string; createdAt: string
  lastAcceptedAt: string | null; lastFailureAt: string | null; failureCount: number
}

export function cleanLabel(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) : ''
  return text || 'Aparelho'
}

export async function registerSubscription(pool: Queryable, input: {
  endpoint: unknown; p256dh: unknown; auth: unknown; label: unknown; actorRef: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await loadPushSettings(pool))) return { ok: false, error: 'MIGRATION_PENDING' }
  const host = pushHostOf(input.endpoint)
  if (!host) return { ok: false, error: 'ENDPOINT_NOT_ALLOWED' }
  if (typeof input.p256dh !== 'string' || typeof input.auth !== 'string') return { ok: false, error: 'INVALID_SUBSCRIPTION' }
  const p256dh = input.p256dh.replace(/=+$/, '')
  const auth = input.auth.replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return { ok: false, error: 'INVALID_SUBSCRIPTION' }
  const key = b64url.decode(p256dh)
  if (key.length !== 65 || key[0] !== 4 || b64url.decode(auth).length !== 16) return { ok: false, error: 'INVALID_SUBSCRIPTION' }
  const active = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm.push_subscriptions WHERE status = 'active' AND endpoint <> $1`, [input.endpoint])
  if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_DEVICES) return { ok: false, error: 'TOO_MANY_DEVICES' }
  const saved = await pool.query<{ id: string }>(
    `INSERT INTO crm.push_subscriptions (endpoint, p256dh, auth, label, push_host, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label,
       status = 'active', revoked_at = NULL, expired_at = NULL, failure_count = 0, updated_at = now()
     RETURNING id`,
    [input.endpoint, p256dh, auth, cleanLabel(input.label), host, 'crm_admin:' + input.actorRef.slice(0, 16)])
  return { ok: true, id: saved.rows[0].id }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Revoga um aparelho (pelo ID ou pelo endpoint do próprio navegador). Entregas pendentes são canceladas. */
export async function revokeSubscription(pool: Queryable, input: { id?: unknown; endpoint?: unknown }): Promise<boolean> {
  const byId = typeof input.id === 'string' && UUID.test(input.id)
  if (!byId && typeof input.endpoint !== 'string') return false
  const done = await pool.query<{ id: string }>(
    `UPDATE crm.push_subscriptions SET status = 'revoked', revoked_at = now(), updated_at = now()
      WHERE ${byId ? 'id = $1' : 'endpoint = $1'} AND status <> 'revoked' RETURNING id`,
    [byId ? input.id : input.endpoint])
  if (!done.rowCount) return false
  await pool.query(
    `UPDATE crm.push_deliveries SET status = 'cancelled', last_error = 'DEVICE_REVOKED', locked_at = NULL, updated_at = now()
      WHERE subscription_id = $1 AND status IN ('pending', 'retry')`, [done.rows[0].id])
  return true
}

export async function listDevices(pool: Queryable): Promise<DeviceRow[]> {
  const rows = await pool.query<{ id: string; label: string; push_host: string; status: string; created_at: Date
    last_accepted_at: Date | null; last_failure_at: Date | null; failure_count: number }>(
    `SELECT id, label, push_host, status, created_at, last_accepted_at, last_failure_at, failure_count
       FROM crm.push_subscriptions ORDER BY (status = 'active') DESC, created_at DESC LIMIT 30`)
  const iso = (d: Date | null) => d ? new Date(d).toISOString() : null
  return rows.rows.map(r => ({ id: r.id, label: r.label, pushHost: r.push_host, status: r.status, createdAt: iso(r.created_at)!,
    lastAcceptedAt: iso(r.last_accepted_at), lastFailureAt: iso(r.last_failure_at), failureCount: r.failure_count }))
}

/** O navegador atual está inscrito e ativo? (pelo endpoint, que só o próprio navegador conhece) */
export async function subscriptionStatus(pool: Queryable, endpoint: unknown): Promise<string | null> {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null
  return (await pool.query<{ status: string }>('SELECT status FROM crm.push_subscriptions WHERE endpoint = $1', [endpoint])).rows[0]?.status ?? null
}

/* -------------------------------------------------------------- enqueue */

export type EnqueueOutcome = 'queued' | 'duplicate' | 'not_ready' | 'migration_pending' | 'disabled' | 'not_eligible'

async function createNotification(pool: Queryable, input: {
  kind: NotificationKind; dedupeKey: string; sequence: 1 | 2; leadId?: string | null; appointmentId?: string | null
  isTest: boolean; subscriptionId?: string | null
}): Promise<string | null> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO crm.push_notifications (kind, dedupe_key, sequence, lead_id, appointment_id, is_test)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [input.kind, input.dedupeKey, input.sequence, input.leadId ?? null, input.appointmentId ?? null, input.isTest])
  const id = inserted.rows[0]?.id
  if (!id) return null
  await pool.query(
    `INSERT INTO crm.push_deliveries (notification_id, subscription_id)
     SELECT $1, s.id FROM crm.push_subscriptions s WHERE s.status = 'active' AND ($2::uuid IS NULL OR s.id = $2::uuid)
     ON CONFLICT (notification_id, subscription_id) DO NOTHING`, [id, input.subscriptionId ?? null])
  return id
}

/** Lead NOVO (o gancho só chama com HTTP 201 e reused=false). O banco confere que o cadastro é recente. */
export async function enqueueLeadNotification(deps: PushDeps, leadId: string): Promise<{ outcome: EnqueueOutcome; ids: string[] }> {
  if (!deps.env().ready) return { outcome: 'not_ready', ids: [] }
  const settings = await loadPushSettings(deps.pool)
  if (!settings) return { outcome: 'migration_pending', ids: [] }
  if (!settings.notifyLeads) return { outcome: 'disabled', ids: [] }
  const lead = (await deps.pool.query<{ is_test: boolean }>(
    `SELECT is_test FROM crm.leads WHERE id = $1 AND created_at > now() - make_interval(mins => $2::int)`,
    [leadId, EVENT_WINDOW_MINUTES])).rows[0]
  if (!lead) return { outcome: 'not_eligible', ids: [] }
  const id = await createNotification(deps.pool, {
    kind: 'lead_created', dedupeKey: 'lead_created:' + leadId, sequence: 1, leadId, isTest: lead.is_test !== false,
  })
  return id ? { outcome: 'queued', ids: [id] } : { outcome: 'duplicate', ids: [] }
}

/** Reunião NOVA: confirmada, com evento no Google, reserva confirmada, término futuro, confirmação recente. */
export async function enqueueMeetingNotifications(
  deps: PushDeps, input: { appointmentId: string; bookingRequestId: string },
): Promise<{ outcome: EnqueueOutcome; ids: string[] }> {
  if (!deps.env().ready) return { outcome: 'not_ready', ids: [] }
  const settings = await loadPushSettings(deps.pool)
  if (!settings) return { outcome: 'migration_pending', ids: [] }
  if (!settings.notifyMeetings) return { outcome: 'disabled', ids: [] }
  const row = (await deps.pool.query<{ lead_id: string; is_test: boolean }>(
    `SELECT a.lead_id, a.is_test
       FROM crm.appointments a
       JOIN crm.booking_requests b ON b.appointment_id = a.id
       JOIN crm.leads l ON l.id = a.lead_id
      WHERE a.id = $1 AND b.id = $2
        AND a.status = 'confirmed' AND a.calendar_event_id IS NOT NULL AND a.confirmed_at IS NOT NULL
        AND b.status = 'confirmed' AND b.google_event_id IS NOT NULL AND b.lead_id = a.lead_id
        AND a.ends_at > now() AND a.confirmed_at > now() - make_interval(mins => $3::int)`,
    [input.appointmentId, input.bookingRequestId, EVENT_WINDOW_MINUTES])).rows[0]
  if (!row) return { outcome: 'not_eligible', ids: [] }
  const isTest = row.is_test !== false
  const first = await createNotification(deps.pool, { kind: 'meeting_confirmed', dedupeKey: 'meeting_confirmed:' + input.appointmentId,
    sequence: 1, appointmentId: input.appointmentId, leadId: row.lead_id, isTest })
  const second = await createNotification(deps.pool, { kind: 'meeting_whatsapp_ready', dedupeKey: 'meeting_whatsapp_ready:' + input.appointmentId,
    sequence: 2, appointmentId: input.appointmentId, leadId: row.lead_id, isTest })
  const ids = [first, second].filter((v): v is string => Boolean(v))
  return ids.length ? { outcome: 'queued', ids } : { outcome: 'duplicate', ids: [] }
}

/** Teste manual pelo painel: só VAPID + banco (a chave geral pode estar desligada). Nada de lead. */
export async function enqueueTestNotification(deps: PushDeps, input: { subscriptionId?: unknown; now?: Date }):
  Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (!deps.env().vapidReady) return { ok: false, error: 'VAPID_NOT_READY' }
  const settings = await loadPushSettings(deps.pool)
  if (!settings) return { ok: false, error: 'MIGRATION_PENDING' }
  const now = input.now ?? new Date()
  if (settings.lastTestAt && now.getTime() - Date.parse(settings.lastTestAt) < TEST_COOLDOWN_SECONDS * 1000) return { ok: false, error: 'TEST_TOO_SOON' }
  const subscriptionId = typeof input.subscriptionId === 'string' && UUID.test(input.subscriptionId) ? input.subscriptionId : null
  const active = await deps.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm.push_subscriptions WHERE status = 'active' AND ($1::uuid IS NULL OR id = $1::uuid)`, [subscriptionId])
  if (!active.rows[0]?.n) return { ok: false, error: 'NO_ACTIVE_DEVICE' }
  await deps.pool.query('UPDATE crm.push_settings SET last_test_at = now() WHERE id = 1')
  const testId = (await deps.pool.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id
  const id = await createNotification(deps.pool, { kind: 'test', dedupeKey: 'test:' + testId, sequence: 1, isTest: true, subscriptionId })
  return id ? { ok: true, ids: [id] } : { ok: false, error: 'TEST_FAILED' }
}

/* ------------------------------------------------------------- dispatch */

type Claimed = { id: string; attempts: number; subscription_id: string; notification_id: string; kind: NotificationKind
  created_at: Date; endpoint: string; p256dh: string; auth: string; sub_status: string
  lead_id: string | null; appointment_id: string | null }

async function claimDelivery(pool: Queryable, deliveryId: string): Promise<Claimed | null> {
  const found = await pool.query<Claimed>(
    `WITH c AS (
       UPDATE crm.push_deliveries d SET status = 'sending', attempts = d.attempts + 1, locked_at = now(), updated_at = now()
        FROM crm.push_notifications n
       WHERE d.id = $1 AND n.id = d.notification_id AND d.status IN ('pending', 'retry') AND d.next_attempt_at <= now()
         AND (n.sequence = 1 OR EXISTS (
               SELECT 1 FROM crm.push_deliveries p JOIN crm.push_notifications pn ON pn.id = p.notification_id
                WHERE pn.appointment_id = n.appointment_id AND pn.sequence = 1
                  AND p.subscription_id = d.subscription_id AND p.status = 'accepted'))
       RETURNING d.id, d.attempts, d.subscription_id, d.notification_id)
     SELECT c.*, n.kind, n.created_at, n.lead_id, n.appointment_id, s.endpoint, s.p256dh, s.auth, s.status AS sub_status
       FROM c JOIN crm.push_notifications n ON n.id = c.notification_id JOIN crm.push_subscriptions s ON s.id = c.subscription_id`,
    [deliveryId])
  return found.rows[0] ?? null
}

async function finishDelivery(pool: Queryable, id: string, status: string, f: { error?: string | null; http?: number | null; waitSeconds?: number } = {}) {
  await pool.query(
    `UPDATE crm.push_deliveries SET status = $2, last_error = $3, http_status = COALESCE($4, http_status), locked_at = NULL,
            accepted_at = CASE WHEN $2 = 'accepted' THEN now() ELSE accepted_at END, updated_at = now(),
            next_attempt_at = CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE now() + make_interval(secs => $5::int) END
      WHERE id = $1 AND status = 'sending'`,
    [id, status, f.error ?? null, f.http ?? null, f.waitSeconds ?? null])
}

async function blockReason(pool: Queryable, c: Claimed): Promise<string | null> {
  if (c.sub_status !== 'active') return 'DEVICE_INACTIVE'
  if (Date.now() - new Date(c.created_at).getTime() > DELIVERY_EXPIRY_HOURS * 3_600_000) return 'EXPIRED'
  if (c.kind === 'meeting_confirmed' || c.kind === 'meeting_whatsapp_ready') {
    const a = (await pool.query<{ status: string; ended: boolean }>(
      'SELECT status, ends_at <= now() AS ended FROM crm.appointments WHERE id = $1', [c.appointment_id])).rows[0]
    if (!a) return 'MEETING_NOT_FOUND'
    if (a.status !== 'confirmed' && a.status !== 'pending') return 'MEETING_CANCELLED'
    if (a.ended) return 'MEETING_ENDED'
  }
  if (c.kind === 'lead_created' && !(await pool.query('SELECT 1 FROM crm.leads WHERE id = $1', [c.lead_id])).rowCount) return 'LEAD_NOT_FOUND'
  return null
}

/** Processa UMA entrega (com tentativas imediatas curtas). Devolve o estado final desta rodada. */
async function processDelivery(deps: PushDeps, deliveryId: string, inline: { left: number }): Promise<string> {
  const log = deps.log ?? defaultLog
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  for (;;) {
    const c = await claimDelivery(deps.pool, deliveryId)
    if (!c) {
      return (await deps.pool.query<{ status: string }>('SELECT status FROM crm.push_deliveries WHERE id = $1', [deliveryId])).rows[0]?.status ?? 'missing'
    }
    const env = deps.env()
    // Teste só exige VAPID; avisos automáticos exigem também a chave geral.
    const allowed = c.kind === 'test' ? env.vapidReady : env.ready
    if (!allowed || !env.vapid || !deps.secret) {
      await finishDelivery(deps.pool, c.id, 'cancelled', { error: 'DISABLED' })
      return 'cancelled'
    }
    const block = await blockReason(deps.pool, c)
    if (block) {
      await finishDelivery(deps.pool, c.id, 'cancelled', { error: block })
      log('cancelled', { deliveryId: c.id, kind: c.kind, code: block })
      return 'cancelled'
    }
    const payload = buildPushPayload({ kind: c.kind, notificationId: c.notification_id, deliveryId: c.id, secret: deps.secret })
    let outcome: PushOutcome
    try {
      outcome = await sendWebPush(deps.fetch, { endpoint: c.endpoint, p256dh: c.p256dh, auth: c.auth }, payload, env.vapid,
        { ttlSeconds: c.kind === 'test' ? 3600 : 43_200, urgency: 'high', timeoutMs: 5_000 })
    } catch {
      outcome = { kind: 'retry', status: null, code: 'CLIENT_ERROR', retryAfterSeconds: 10 }
    }
    if (outcome.kind === 'accepted') {
      await finishDelivery(deps.pool, c.id, 'accepted', { http: outcome.status })
      await deps.pool.query(`UPDATE crm.push_subscriptions SET last_accepted_at = now(), failure_count = 0, updated_at = now() WHERE id = $1`, [c.subscription_id])
      log('accepted', { deliveryId: c.id, kind: c.kind, attempt: c.attempts })
      return 'accepted'
    }
    if (outcome.kind === 'gone') {
      await finishDelivery(deps.pool, c.id, 'gone', { http: outcome.status, error: 'SUBSCRIPTION_GONE' })
      await deps.pool.query(`UPDATE crm.push_subscriptions SET status = 'expired', expired_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'`, [c.subscription_id])
      await deps.pool.query(`UPDATE crm.push_deliveries SET status = 'cancelled', last_error = 'DEVICE_EXPIRED', updated_at = now()
        WHERE subscription_id = $1 AND status IN ('pending', 'retry')`, [c.subscription_id])
      log('subscription_expired', { deliveryId: c.id, status: outcome.status })
      return 'gone'
    }
    await deps.pool.query(`UPDATE crm.push_subscriptions SET last_failure_at = now(), failure_count = failure_count + 1, updated_at = now() WHERE id = $1`, [c.subscription_id])
    if (outcome.kind === 'retry' && c.attempts < MAX_ATTEMPTS) {
      const wait = Math.max(outcome.retryAfterSeconds, BACKOFF_SECONDS[Math.min(c.attempts - 1, BACKOFF_SECONDS.length - 1)])
      await finishDelivery(deps.pool, c.id, 'retry', { http: outcome.status, error: outcome.code, waitSeconds: wait })
      log('retry_scheduled', { deliveryId: c.id, kind: c.kind, attempt: c.attempts, code: outcome.code, waitSeconds: wait })
      if (inline.left > 0 && wait <= INLINE_MAX_WAIT_SECONDS) { inline.left -= 1; await sleep(wait * 1000); continue }
      return 'retry'
    }
    const code = outcome.kind === 'retry' ? 'MAX_ATTEMPTS_' + outcome.code : outcome.code
    await finishDelivery(deps.pool, c.id, 'failed', { http: outcome.status, error: code })
    if (outcome.kind === 'failed' && outcome.code === 'VAPID_REJECTED') {
      // Inscrição feita com outra chave VAPID: o aparelho precisa ser autorizado de novo.
      await deps.pool.query(`UPDATE crm.push_subscriptions SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'active'`, [c.subscription_id])
    }
    log('failed', { deliveryId: c.id, kind: c.kind, attempt: c.attempts, code })
    return 'failed'
  }
}

/** Cancela a entrega 2 de aparelhos em que a 1 terminou sem ser aceita (não há o que confirmar). */
async function cancelOrphanSecondDeliveries(pool: Queryable, notificationIds: string[]) {
  await pool.query(
    `UPDATE crm.push_deliveries d SET status = 'cancelled', last_error = 'PREVIOUS_NOT_DELIVERED', updated_at = now()
       FROM crm.push_notifications n
      WHERE d.notification_id = n.id AND n.id = ANY($1::uuid[]) AND n.sequence = 2 AND d.status IN ('pending', 'retry')
        AND EXISTS (SELECT 1 FROM crm.push_deliveries p JOIN crm.push_notifications pn ON pn.id = p.notification_id
                     WHERE pn.appointment_id = n.appointment_id AND pn.sequence = 1 AND p.subscription_id = d.subscription_id
                       AND p.status IN ('failed', 'gone', 'cancelled'))`, [notificationIds])
}

/** Envia as entregas pendentes dos avisos indicados, em ordem (sequência 1 antes da 2). */
export async function dispatchNotifications(deps: PushDeps, notificationIds: string[], opts: { inlineRetries?: number } = {}):
  Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  if (!notificationIds.length) return result
  const inline = { left: opts.inlineRetries ?? 2 }
  const rows = await deps.pool.query<{ id: string; notification_id: string }>(
    `SELECT d.id, d.notification_id FROM crm.push_deliveries d JOIN crm.push_notifications n ON n.id = d.notification_id
      WHERE d.notification_id = ANY($1::uuid[]) ORDER BY n.sequence, n.created_at, d.created_at`, [notificationIds])
  for (const row of rows.rows) {
    result[row.id] = await processDelivery(deps, row.id, inline)
    if (result[row.id] !== 'accepted') await cancelOrphanSecondDeliveries(deps.pool, notificationIds)
  }
  return result
}

/**
 * Manutenção oportunista (a Vercel não executa Cron em deploys Preview): roda depois de cada evento,
 * quando o administrador abre o CRM e pelo botão "Reprocessar". Também pode ser chamada por um
 * agendador externo protegido (rota /api/crm/push/process), se for configurado no futuro.
 */
export async function sweepPushQueue(deps: PushDeps, opts: { limit?: number; skip?: string[] } = {}): Promise<number> {
  if (!deps.env().vapidReady) return 0
  if (!(await loadPushSettings(deps.pool))) return 0
  // "Enviando" interrompido: repetir é seguro (tag fixa no aparelho).
  await deps.pool.query(
    `UPDATE crm.push_deliveries SET status = 'retry', locked_at = NULL, last_error = 'INTERRUPTED', updated_at = now()
      WHERE status = 'sending' AND locked_at < now() - make_interval(mins => $1::int)`, [STALE_SENDING_MINUTES])
  await deps.pool.query(
    `UPDATE crm.push_deliveries d SET status = 'cancelled', last_error = 'EXPIRED', updated_at = now()
       FROM crm.push_notifications n
      WHERE d.notification_id = n.id AND d.status IN ('pending', 'retry')
        AND n.created_at < now() - make_interval(hours => $1::int)`, [DELIVERY_EXPIRY_HOURS])
  const due = await deps.pool.query<{ id: string }>(
    `SELECT n.id FROM crm.push_notifications n
      WHERE EXISTS (SELECT 1 FROM crm.push_deliveries d WHERE d.notification_id = n.id
                     AND d.status IN ('pending', 'retry') AND d.next_attempt_at <= now())
        AND NOT (n.id = ANY($2::uuid[]))
      ORDER BY n.created_at, n.sequence LIMIT $1`,
    [Math.max(1, Math.min(opts.limit ?? 10, 30)), opts.skip ?? []])
  if (due.rows.length) await dispatchNotifications(deps, due.rows.map(r => r.id), { inlineRetries: 0 })
  return due.rows.length
}

/** Trabalho de um evento: envio em ordem + manutenção. Nunca lança. */
export async function deliverAfterEvent(deps: PushDeps, ids: string[]): Promise<void> {
  const log = deps.log ?? defaultLog
  try { await dispatchNotifications(deps, ids) } catch { log('dispatch_error', { code: 'DB_ERROR' }) }
  try { await sweepPushQueue(deps, { skip: ids }) } catch { log('sweep_error', { code: 'DB_ERROR' }) }
}

/* ----------------------------------------------------- receipts / opening */

/** Recibo do service worker: exibida (displayed) ou tocada (clicked). Só preenche uma vez. */
export async function recordReceipt(pool: Queryable, deliveryId: string, event: 'displayed' | 'clicked'): Promise<boolean> {
  // Tocar implica que foi exibida (alguns navegadores não deixam o recibo "exibida" sair a tempo).
  const done = await pool.query(event === 'displayed'
    ? `UPDATE crm.push_deliveries SET displayed_at = COALESCE(displayed_at, now()), updated_at = now() WHERE id = $1 AND status = 'accepted'`
    : `UPDATE crm.push_deliveries SET clicked_at = COALESCE(clicked_at, now()), displayed_at = COALESCE(displayed_at, now()), updated_at = now()
        WHERE id = $1 AND status = 'accepted'`, [deliveryId])
  return Boolean(done.rowCount)
}

/** Abertura autenticada do aviso → destino interno do CRM. Marca opened_at. */
export async function resolveNotification(pool: Queryable, notificationId: string): Promise<string> {
  if (!UUID.test(notificationId)) return '/crm'
  const n = (await pool.query<{ kind: NotificationKind; lead_id: string | null; appointment_id: string | null }>(
    `UPDATE crm.push_notifications SET opened_at = COALESCE(opened_at, now()) WHERE id = $1
     RETURNING kind, lead_id, appointment_id`, [notificationId])).rows[0]
  if (!n) return '/crm'
  if (n.kind === 'lead_created' && n.lead_id) return '/crm?lead=' + n.lead_id
  if (n.kind === 'meeting_confirmed' && n.appointment_id) return '/crm/reuniao/' + n.appointment_id
  if (n.kind === 'meeting_whatsapp_ready' && n.appointment_id) return '/crm/reuniao/' + n.appointment_id + '?whatsapp=1'
  return '/crm?view=notificacoes'
}

export type HistoryRow = {
  id: string; kind: NotificationKind; isTest: boolean; createdAt: string; openedAt: string | null; cancelReason: string | null
  deliveries: { total: number; accepted: number; displayed: number; clicked: number; pending: number; failed: number; cancelled: number }
  lastError: string | null
}

/** Histórico sem dados pessoais: tipo, horários e contagem de estados por aparelho. */
export async function listHistory(pool: Queryable, limit = 30): Promise<HistoryRow[]> {
  const rows = await pool.query<{ id: string; kind: NotificationKind; is_test: boolean; created_at: Date; opened_at: Date | null
    cancel_reason: string | null; total: number; accepted: number; displayed: number; clicked: number; pending: number
    failed: number; cancelled: number; last_error: string | null }>(
    `SELECT n.id, n.kind, n.is_test, n.created_at, n.opened_at, n.cancel_reason,
            count(d.id)::int AS total,
            count(d.id) FILTER (WHERE d.status = 'accepted')::int AS accepted,
            count(d.displayed_at)::int AS displayed, count(d.clicked_at)::int AS clicked,
            count(d.id) FILTER (WHERE d.status IN ('pending', 'retry', 'sending'))::int AS pending,
            count(d.id) FILTER (WHERE d.status IN ('failed', 'gone'))::int AS failed,
            count(d.id) FILTER (WHERE d.status = 'cancelled')::int AS cancelled,
            (array_agg(d.last_error ORDER BY d.updated_at DESC) FILTER (WHERE d.last_error IS NOT NULL))[1] AS last_error
       FROM crm.push_notifications n LEFT JOIN crm.push_deliveries d ON d.notification_id = n.id
      GROUP BY n.id ORDER BY n.created_at DESC, n.sequence DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))])
  const iso = (d: Date | null) => d ? new Date(d).toISOString() : null
  return rows.rows.map(r => ({
    id: r.id, kind: r.kind, isTest: r.is_test !== false, createdAt: iso(r.created_at)!, openedAt: iso(r.opened_at), cancelReason: r.cancel_reason,
    deliveries: { total: r.total, accepted: r.accepted, displayed: r.displayed, clicked: r.clicked, pending: r.pending, failed: r.failed, cancelled: r.cancelled },
    lastError: r.last_error,
  }))
}
