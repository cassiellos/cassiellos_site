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

export type Queryable = Pick<Pool, 'query'>

export const MAX_ATTEMPTS = 5

export type CommsStatus = 'pending' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'cancelled' | 'skipped'

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
export async function claimForSend(pool: Queryable, id: string): Promise<CommsMessage | null> {
  const result = await pool.query<Row>(
    `UPDATE crm.comms_messages
        SET attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND status = 'pending' AND attempts < $2
      RETURNING ${COLUMNS}`, [id, MAX_ATTEMPTS])
  return result.rows[0] ? toMessage(result.rows[0]) : null
}

export async function markSent(
  pool: Queryable, id: string, input: { providerMessageId: string; scheduled: boolean },
): Promise<void> {
  // 'scheduled' = aceita com horário futuro; 'sent' = aceita para envio imediato. Nenhum dos dois é "entregue".
  await pool.query(
    `UPDATE crm.comms_messages
        SET status = $2, provider_message_id = $3, sent_at = now(), last_error = NULL, updated_at = now()
      WHERE id = $1`, [id, input.scheduled ? 'scheduled' : 'sent', input.providerMessageId])
}

/** Erro retriável volta a 'pending' até esgotar as tentativas; o resto encerra em 'failed'. */
export async function markFailure(
  pool: Queryable, id: string, input: { error: string; retriable: boolean },
): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages
        SET status = CASE WHEN $3::boolean AND attempts < $4 THEN 'pending' ELSE 'failed' END,
            last_error = left($2, 400), updated_at = now()
      WHERE id = $1`, [id, input.error, input.retriable, MAX_ATTEMPTS])
}

export async function markSkipped(pool: Queryable, id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE crm.comms_messages SET status = 'skipped', last_error = left($2, 400), updated_at = now()
      WHERE id = $1 AND status = 'pending'`, [id, reason])
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
        SET status = 'cancelled', updated_at = now()
      WHERE appointment_id = $1 AND status IN ('pending', 'scheduled')
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
        AND status NOT IN ('cancelled', 'delivered', 'failed')`,
    [providerMessageId, status, error ?? null])
  return (result.rowCount ?? 0) > 0
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

/** Reenvio administrativo: devolve a linha para 'pending' e zera as tentativas. */
export async function requeueForResend(pool: Queryable, id: string): Promise<CommsMessage | null> {
  const result = await pool.query<Row>(
    `UPDATE crm.comms_messages
        SET status = 'pending', attempts = 0, last_error = NULL,
            provider_message_id = NULL, sent_at = NULL, scheduled_for = now(), updated_at = now()
      WHERE id = $1 AND channel = 'email' AND status IN ('failed', 'skipped', 'cancelled')
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
