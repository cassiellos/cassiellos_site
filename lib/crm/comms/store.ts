import type { Pool } from 'pg'
import { generatePublicReference, isPublicReference, referenceExpiresAt } from './reference'
import type { PlannedMessage } from './plan'

/**
 * Persistência das comunicações (crm.comms_messages e crm.comms_whatsapp_refs).
 *
 * Idempotência: `dedupe_key` é UNIQUE e toda inserção usa ON CONFLICT DO NOTHING. Confirmar a mesma
 * reunião duas vezes, repetir o webhook, reexecutar a varredura ou clicar em "reenviar" nunca cria
 * uma segunda mensagem lógica. A reserva para envio é um UPDATE condicional (… WHERE status='pending'
 * RETURNING), então duas execuções simultâneas da varredura não enviam a mesma linha duas vezes.
 *
 * Estados honestos: 'sent' é "a Resend aceitou"; só o webhook muda para 'delivered'.
 * Nenhum endereço real é gravado aqui (ver mask.ts).
 */

export type Queryable = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>

export const MAX_ATTEMPTS = 5

export type CommsStatus = 'pending' | 'sending' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'cancel_requested' | 'cancelled' | 'skipped' | 'needs_review'

export type CommsMessage = {
  id: string
  appointmentId: string
  channel: 'email' | 'whatsapp'
  kind: string
  dedupeKey: string
  recipientMasked: string | null
  scheduledFor: string | null
  sentAt: string | null
  providerMessageId: string | null
  status: CommsStatus
  attempts: number
  lastError: string | null
  createdAt: string
}

const COLUMNS = `id, appointment_id, channel, kind, dedupe_key, recipient_masked, scheduled_for,
  sent_at, provider_message_id, status, attempts, last_error, created_at`

type Row = {
  id: string; appointment_id: string; channel: string; kind: string; dedupe_key: string
  recipient_masked: string | null; scheduled_for: Date | null; sent_at: Date | null
  provider_message_id: string | null; status: string; attempts: number
  last_error: string | null; created_at: Date
}

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null)

function toMessage(row: Row): CommsMessage {
  return {
    id: row.id, appointmentId: row.appointment_id,
    channel: row.channel as 'email' | 'whatsapp', kind: row.kind, dedupeKey: row.dedupe_key,
    recipientMasked: row.recipient_masked, scheduledFor: iso(row.scheduled_for), sentAt: iso(row.sent_at),
    providerMessageId: row.provider_message_id, status: row.status as CommsStatus,
    attempts: row.attempts, lastError: row.last_error, createdAt: new Date(row.created_at).toISOString(),
  }
}

/* ------------------------------------------------------------ a reunião */

export type MeetingRecord = {
  appointmentId: string
  leadId: string
  name: string | null
  email: string | null
  whatsapp: string | null
  startAt: string
  endAt: string
  meetingUrl: string | null
  status: string
}

/** Dados da reunião para montar a mensagem. O endereço real sai daqui e não é copiado para comms_messages. */
export async function loadMeeting(pool: Queryable, appointmentId: string): Promise<MeetingRecord | null> {
  const result = await pool.query<{
    id: string; lead_id: string; full_name: string | null; email: string | null; whatsapp: string | null
    starts_at: Date; ends_at: Date; meeting_url: string | null; status: string
  }>(
    `SELECT a.id, a.lead_id, l.full_name, l.email, l.whatsapp,
            a.starts_at, a.ends_at, a.meeting_url, a.status
       FROM crm.appointments a JOIN crm.leads l ON l.id = a.lead_id
      WHERE a.id = $1`, [appointmentId])
  const row = result.rows[0]
  if (!row) return null
  return {
    appointmentId: row.id, leadId: row.lead_id, name: row.full_name, email: row.email, whatsapp: row.whatsapp,
    startAt: new Date(row.starts_at).toISOString(), endAt: new Date(row.ends_at).toISOString(),
    meetingUrl: row.meeting_url, status: row.status,
  }
}

/* -------------------------------------------------------------- a fila */

/** Cria as mensagens planejadas. Já existentes são ignoradas (ON CONFLICT), nunca duplicadas. */
export async function enqueueMessages(
  pool: Queryable,
  input: { appointmentId: string; planned: PlannedMessage[]; recipientMasked: string | null },
): Promise<CommsMessage[]> {
  if (!input.planned.length) return []
  const created: CommsMessage[] = []
  for (const item of input.planned) {
    const result = await pool.query<Row>(
      `INSERT INTO crm.comms_messages
         (appointment_id, channel, kind, dedupe_key, recipient_masked, scheduled_for, status)
       VALUES ($1, 'email', $2, $3, $4, $5, 'pending')
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING ${COLUMNS}`,
      [input.appointmentId, item.kind, item.dedupeKey, input.recipientMasked, item.sendAt])
    if (result.rows[0]) created.push(toMessage(result.rows[0]))
  }
  return created
}

/** Reserva a linha para envio. null = outra execução já pegou, ou o estado mudou. */
export type EmailQuota = { dailyCap: number; monthlyCap: number; now?: Date }

/**
 * Reserve an email under a single PostgreSQL transaction and account-wide advisory lock.
 * The lock serializes distinct meetings, not just duplicate calls for the same message.
 * Capacity is conservatively reserved on BOTH the provider-submission date and scheduled-delivery
 * date; reminders may only use 80% of daily / 90% of monthly headroom, keeping space for confirmations.
 * Requires a real pg.Pool.connect(): silently falling back to independent pool.query calls would
 * recreate the original concurrency race, so missing transaction support fails closed.
 */
export async function claimForSend(pool: Queryable, id: string, quota?: EmailQuota): Promise<CommsMessage | null> {
  if (typeof pool.connect !== 'function') throw new Error('TRANSACTIONAL_POOL_REQUIRED')
  const client = await pool.connect()
  const now = quota?.now ?? new Date()
  const dailyCap = Math.max(1, Math.min(100, quota?.dailyCap ?? 100))
  const monthlyCap = Math.max(1, Math.min(3000, quota?.monthlyCap ?? 3000))
  const day = (d: Date) => [
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)),
  ] as const
  const month = (d: Date) => [
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
  ] as const
  try {
    await client.query('BEGIN')
    // Shared advisory lock: all CRM email reservations serialize across serverless instances.
    await client.query('SELECT pg_advisory_xact_lock(726901, 1)')
    const pending = await client.query<{ kind: string; scheduled_for: Date | null }>(
      `SELECT kind, scheduled_for FROM crm.comms_messages
        WHERE id = $1 AND channel = 'email' AND status = 'pending'
          AND attempts < $2 FOR UPDATE`, [id, MAX_ATTEMPTS])
    const current = pending.rows[0]
    if (!current) { await client.query('COMMIT'); return null }
    const target = current.scheduled_for && new Date(current.scheduled_for) > now
      ? new Date(current.scheduled_for) : now
    const reminder = current.kind !== 'confirmation'
    const limits = { day: reminder ? Math.max(1, Math.floor(dailyCap * .8)) : dailyCap,
                     month: reminder ? Math.max(1, Math.floor(monthlyCap * .9)) : monthlyCap }
    const checked = new Set<string>()
    for (const [scope, date] of [['day', now], ['day', target], ['month', now], ['month', target]] as const) {
      const [first, last] = scope === 'day' ? day(date) : month(date)
      const key = scope + ':' + first.toISOString()
      if (checked.has(key)) continue
      checked.add(key)
      const counter = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM crm.comms_messages
          WHERE channel = 'email'
            AND status IN ('sending', 'scheduled', 'sent', 'delivered', 'cancel_requested', 'needs_review')
            AND ((claimed_at >= $1 AND claimed_at < $2)
                 OR (scheduled_for >= $1 AND scheduled_for < $2 AND scheduled_for > claimed_at))`,
        [first.toISOString(), last.toISOString()])
      if (Number(counter.rows[0]?.total ?? '0') >= limits[scope]) {
        await client.query(
          `UPDATE crm.comms_messages SET status = 'skipped', last_error = $2, updated_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [id, scope === 'day' ? 'DAILY_CAP' : 'MONTHLY_CAP'])
        await client.query('COMMIT')
        return null
      }
    }
    const claimed = await client.query<Row>(
      `UPDATE crm.comms_messages
          SET attempts = attempts + 1, status = 'sending', claimed_at = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending' AND attempts < $2
        RETURNING ${COLUMNS}`, [id, MAX_ATTEMPTS, now.toISOString()])
    await client.query('COMMIT')
    return claimed.rows[0] ? toMessage(claimed.rows[0]) : null
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* preserve original error */ }
    throw error
  } finally { client.release() }
}

export async function markSent(
  pool: Queryable, id: string, input: { providerMessageId: string; scheduled: boolean },
): Promise<boolean> {
  // 'scheduled' = aceita com horário futuro; 'sent' = aceita para envio imediato. Nenhum dos dois é "entregue".
  const result = await pool.query<{ status: string }>(
    `UPDATE crm.comms_messages
        SET status = CASE WHEN status = 'cancel_requested' THEN status ELSE $2 END,
            provider_message_id = $3, sent_at = now(), last_error = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('sending', 'cancel_requested')
      RETURNING status`, [id, input.scheduled ? 'scheduled' : 'sent', input.providerMessageId])
  return result.rows[0]?.status === 'cancel_requested'
}

/** Erro retriável volta a 'pending' até esgotar as tentativas; o resto encerra em 'failed'. */
export async function markFailure(
  pool: Queryable, id: string, input: { error: string; retriable: boolean },
): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages
        SET status = CASE WHEN $2 = 'NETWORK_OR_TIMEOUT' THEN 'needs_review' WHEN $3::boolean AND attempts < $4 THEN 'pending' ELSE 'failed' END,
            last_error = left($2, 400), updated_at = now()
      WHERE id = $1 AND status = 'sending'`, [id, input.error, input.retriable, MAX_ATTEMPTS])
}

export async function markSkipped(pool: Queryable, id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages SET status = 'skipped', last_error = left($2, 400), updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'sending')`, [id, reason])
}

/**
 * Varredura: mensagens pendentes que já venceram OU que já cabem no agendamento nativo do provedor.
 *
 * O segundo caso é o que torna uma varredura DIÁRIA suficiente. Uma reunião marcada para daqui a
 * 80 dias deixa o lembrete de 1 h fora da janela de 30 dias da Resend; esperar o horário dele
 * exigiria uma varredura de minuto em minuto. Entregando assim que entra na janela, a Resend
 * segura a mensagem e a varredura só precisa rodar antes de a reunião chegar a 30 dias.
 */
export async function dueMessages(
  pool: Queryable, limit: number, now: Date = new Date(), horizon?: Date,
): Promise<CommsMessage[]> {
  const until = (horizon ?? now).toISOString()
  const result = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM crm.comms_messages
      WHERE status = 'pending' AND scheduled_for IS NOT NULL AND scheduled_for <= $1 AND attempts < $2
      ORDER BY scheduled_for ASC LIMIT $3`, [until, MAX_ATTEMPTS, Math.min(limit, 50)])
  return result.rows.map(toMessage)
}

/**
 * Reunião cancelada ou remarcada: nada pendente pode sair. Devolve os ids já entregues ao provedor
 * para que o chamador os cancele lá também (a Resend guarda o agendamento do lado dela).
 */
export async function cancelPending(pool: Queryable, appointmentId: string): Promise<string[]> {
  const result = await pool.query<{ provider_message_id: string | null }>(
    `UPDATE crm.comms_messages
        SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE 'cancel_requested' END,
            updated_at = now()
      WHERE appointment_id = $1 AND status IN ('pending', 'sending', 'scheduled')
      RETURNING provider_message_id`, [appointmentId])
  return result.rows.map(r => r.provider_message_id).filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** Webhook do provedor. Nunca rebaixa um estado final nem ressuscita o que foi cancelado. */
export async function applyProviderStatus(
  pool: Queryable, providerMessageId: string, status: 'sent' | 'scheduled' | 'delivered' | 'failed',
  error?: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE crm.comms_messages
        SET status = $2, provider_status_at = now(), updated_at = now(),
            last_error = COALESCE(left($3, 400), last_error)
      WHERE provider_message_id = $1
        AND status NOT IN ('cancel_requested', 'cancelled', 'delivered', 'failed', 'needs_review')`,
    [providerMessageId, status, error ?? null])
  return (result.rowCount ?? 0) > 0
}

/** Reconciles cancellations after interrupted serverless callbacks. */
export async function reconcileProviderCancellations(pool: Queryable): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages m
        SET status = 'cancel_requested', updated_at = now()
       FROM crm.appointments a
      WHERE a.id = m.appointment_id AND m.channel = 'email'
        AND a.status NOT IN ('pending', 'confirmed')
        AND m.status IN ('scheduled', 'sending')`)
}

export async function cancellationQueue(pool: Queryable, limit = 25): Promise<string[]> {
  const result = await pool.query<{ provider_message_id: string }>(
    `SELECT provider_message_id FROM crm.comms_messages
       WHERE channel = 'email' AND status = 'cancel_requested'
         AND provider_message_id IS NOT NULL
         AND updated_at < now() - interval '1 minute'
       ORDER BY updated_at ASC LIMIT $1`, [Math.min(limit, 50)])
  return result.rows.map(row => row.provider_message_id)
}

export async function confirmProviderCancellation(pool: Queryable, id: string): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages SET status = 'cancelled', last_error = NULL, updated_at = now()
      WHERE provider_message_id = $1 AND status = 'cancel_requested'`, [id])
}

export async function recordProviderCancellationError(pool: Queryable, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages SET last_error = left($2, 400), updated_at = now()
      WHERE provider_message_id = $1 AND status = 'cancel_requested'`, [id, 'CANCEL_UNCONFIRMED:' + error])
}

/** Consumo do período para as travas do plano gratuito (conta o que foi entregue ao provedor). */
export async function usageSince(pool: Queryable, channel: 'email' | 'whatsapp', since: Date): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM crm.comms_messages
      WHERE channel = $1 AND sent_at IS NOT NULL AND sent_at >= $2`, [channel, since.toISOString()])
  return Number(result.rows[0]?.total ?? '0')
}

export async function listForAppointment(pool: Queryable, appointmentId: string): Promise<CommsMessage[]> {
  const result = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM crm.comms_messages WHERE appointment_id = $1 ORDER BY created_at ASC`,
    [appointmentId])
  return result.rows.map(toMessage)
}

/** Reenvio administrativo: nunca ressuscita mensagem cancelada ou lembrete vencido.
 * Lembretes futuros mantêm o horário original; só confirmação é imediata. */
export async function requeueForResend(pool: Queryable, id: string): Promise<CommsMessage | null> {
  const result = await pool.query<Row>(
    `UPDATE crm.comms_messages
        SET status = 'pending', attempts = 0, last_error = NULL,
            provider_message_id = NULL, sent_at = NULL,
            scheduled_for = CASE WHEN kind = 'confirmation' THEN now() ELSE scheduled_for END,
            updated_at = now()
      WHERE id = $1 AND channel = 'email' AND status IN ('failed', 'skipped')
        AND EXISTS (SELECT 1 FROM crm.appointments a WHERE a.id = appointment_id
                    AND a.status IN ('pending', 'confirmed') AND a.starts_at > now())
        AND (kind = 'confirmation' OR scheduled_for >= now() - interval '5 minutes')
      RETURNING ${COLUMNS}`, [id])
  return result.rows[0] ? toMessage(result.rows[0]) : null
}

/* ------------------------------------------- referência pública do WhatsApp */

/**
 * Referência opaca da reunião. Uma por reunião: chamar de novo devolve a mesma enquanto valer,
 * então recarregar a página de confirmação não enche a tabela nem muda o código já visto pelo lead.
 * Colisão do código aleatório (improvável) simplesmente tenta outro.
 */
export async function ensureWhatsappReference(
  pool: Queryable, appointmentId: string, now: Date = new Date(),
): Promise<string | null> {
  const existing = await pool.query<{ ref: string }>(
    `SELECT ref FROM crm.comms_whatsapp_refs
      WHERE appointment_id = $1 AND expires_at > $2 ORDER BY created_at DESC LIMIT 1`,
    [appointmentId, now.toISOString()])
  if (existing.rows[0]) return existing.rows[0].ref

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = generatePublicReference()
    const inserted = await pool.query<{ ref: string }>(
      `INSERT INTO crm.comms_whatsapp_refs (ref, appointment_id, expires_at)
       VALUES ($1, $2, $3) ON CONFLICT (ref) DO NOTHING RETURNING ref`,
      [ref, appointmentId, referenceExpiresAt(now).toISOString()])
    if (inserted.rows[0]) return inserted.rows[0].ref
  }
  return null
}

/** Modo B: da referência recebida no WhatsApp para a reunião. Expirada = não encontrada. */
export async function appointmentByReference(
  pool: Queryable, ref: string, now: Date = new Date(),
): Promise<string | null> {
  if (!isPublicReference(ref)) return null
  const result = await pool.query<{ appointment_id: string }>(
    `UPDATE crm.comms_whatsapp_refs SET matched_at = COALESCE(matched_at, now())
      WHERE ref = $1 AND expires_at > $2 RETURNING appointment_id`, [ref, now.toISOString()])
  return result.rows[0]?.appointment_id ?? null
}

/**
 * Reunião confirmada que pertence À SESSÃO de agendamento em curso. É o que autoriza o botão de
 * WhatsApp: só o titular daquela inscrição assinada recebe a referência da própria reunião.
 */
export async function appointmentForSession(
  pool: Queryable, input: { bookingRequestId: string; leadId: string; submissionId: string },
): Promise<{ appointmentId: string; startAt: string } | null> {
  const result = await pool.query<{ appointment_id: string; starts_at: Date }>(
    `SELECT b.appointment_id, a.starts_at
       FROM crm.booking_requests b JOIN crm.appointments a ON a.id = b.appointment_id
      WHERE b.id = $1 AND b.lead_id = $2 AND b.submission_id = $3 AND b.status = 'confirmed'
        AND a.status IN ('pending', 'confirmed') AND a.ends_at > now()`,
    [input.bookingRequestId, input.leadId, input.submissionId])
  const row = result.rows[0]
  return row?.appointment_id
    ? { appointmentId: row.appointment_id, startAt: new Date(row.starts_at).toISOString() }
    : null
}

/**
 * Reserva a ÚNICA resposta automática de WhatsApp daquela reunião. A chave é por reunião, não por
 * mensagem recebida: se o lead mandar a referência cinco vezes (ou a Meta reenviar o webhook), só a
 * primeira cria a linha. null = já existe, não responder de novo.
 */
export async function claimWhatsappReply(
  pool: Queryable, input: { appointmentId: string; dedupeKey: string; recipientMasked: string | null },
): Promise<CommsMessage | null> {
  const result = await pool.query<Row>(
    `INSERT INTO crm.comms_messages
       (appointment_id, channel, kind, dedupe_key, recipient_masked, status, attempts)
     VALUES ($1, 'whatsapp', 'whatsapp_auto_reply', $2, $3, 'pending', 1)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [input.appointmentId, input.dedupeKey, input.recipientMasked])
  return result.rows[0] ? toMessage(result.rows[0]) : null
}
