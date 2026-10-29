import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { ConnectablePool } from './booking-reservation'
import { bookingEventId, type GoogleCancelResult, type GoogleEventState } from './google-event-ops'

/**
 * Controles administrativos do Mini CRM (Fase 3.4). Sem dependências de framework.
 *
 * Princípios:
 * - Nada é apagado: reuniões, reservas e atividades anteriores são preservadas.
 * - Toda ação grava uma atividade com quem fez (sessão administrativa) e quando.
 * - O CRM só libera um horário depois que o Google CONFIRMA o cancelamento
 *   (ou confirma que o evento não existe). Falha ou dúvida = nada muda, e a
 *   ação pode ser repetida com segurança (o cancelamento no Google é idempotente).
 * - Ações repetidas ou simultâneas não duplicam efeitos (atualizações condicionais).
 * - Correção de classificação vale para registros FUTUROS; nada antigo é alterado
 *   e nenhuma conversão é enviada (a Meta CAPI não está ativa).
 */

export type AdminActor = { kind: 'crm_admin'; sessionRef: string }

/** Referência não reversível da sessão administrativa (auditoria sem expor o cookie). */
export function adminActorFromSession(sessionToken: string): AdminActor {
  return { kind: 'crm_admin', sessionRef: createHash('sha256').update(sessionToken).digest('hex').slice(0, 16) }
}

type Result<T extends string> = { status: number; outcome: T; details?: Record<string, unknown> }

async function inTransaction<T>(pool: ConnectablePool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    const value = await fn(client)
    await client.query('COMMIT')
    committed = true
    return value
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}

function cleanReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null
  const value = reason.trim().replace(/[\u0000-\u001f\u007f]/g, ' ')
  return value ? value.slice(0, 300) : null
}

async function logActivity(client: PoolClient, input: {
  leadId: string; appointmentId?: string | null; kind: string; actor: AdminActor; details: Record<string, unknown>
}) {
  await client.query(
    `INSERT INTO crm.lead_activities (lead_id, appointment_id, activity_kind, performed_by, details)
     VALUES ($1, $2, $3, 'crm_admin', $4::jsonb)`,
    [input.leadId, input.appointmentId ?? null, input.kind,
      JSON.stringify({ ...input.details, sessionRef: input.actor.sessionRef })],
  )
}

/* ------------------------------------------------------------------ cancelar */

export type CancelMeetingDeps = {
  pool: ConnectablePool
  cancelGoogleEvent: (calendarId: string, eventId: string) => Promise<GoogleCancelResult>
}

export type CancelOutcome = 'cancelled' | 'already_cancelled' | 'not_found' | 'not_cancellable' |
  'already_ended' | 'google_not_confirmed'

type MeetingRow = { status: string; ends_at: Date; starts_at: Date; calendar_id: string; calendar_event_id: string | null }

export async function cancelMeeting(deps: CancelMeetingDeps, input: {
  leadId: string; appointmentId: string; actor: AdminActor; reason?: unknown; now?: Date
}): Promise<Result<CancelOutcome>> {
  const now = input.now ?? new Date()
  const reason = cleanReason(input.reason)

  // 1) Validate (no changes yet).
  const meeting = await inTransaction(deps.pool, async client => (await client.query<MeetingRow>(
    `SELECT status, starts_at, ends_at, calendar_id, calendar_event_id FROM crm.appointments
      WHERE id = $1 AND lead_id = $2 FOR UPDATE`, [input.appointmentId, input.leadId])).rows[0])
  if (!meeting) return { status: 404, outcome: 'not_found' }
  if (meeting.status === 'cancelled') return { status: 200, outcome: 'already_cancelled' }
  if (meeting.status !== 'confirmed' && meeting.status !== 'pending') return { status: 409, outcome: 'not_cancellable' }
  if (new Date(meeting.ends_at).getTime() <= now.getTime()) return { status: 409, outcome: 'already_ended' }

  // 2) Google first. Without confirmation nothing is released in the CRM.
  let google: GoogleCancelResult | 'no_event' = 'no_event'
  if (meeting.calendar_event_id) {
    try {
      google = await deps.cancelGoogleEvent(meeting.calendar_id, meeting.calendar_event_id)
    } catch {
      await inTransaction(deps.pool, client => logActivity(client, {
        leadId: input.leadId, appointmentId: input.appointmentId, kind: 'meeting_cancel_sync_failed', actor: input.actor,
        details: { reason, result: 'google_not_confirmed' },
      }))
      return { status: 502, outcome: 'google_not_confirmed' }
    }
  }

  // 3) Record the cancellation once (concurrent or repeated requests are no-ops).
  return inTransaction(deps.pool, async client => {
    const updated = await client.query(
      `UPDATE crm.appointments SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = $1 AND lead_id = $2 AND status IN ('pending', 'confirmed') RETURNING id`,
      [input.appointmentId, input.leadId])
    if (!updated.rowCount) return { status: 200, outcome: 'already_cancelled' as const }
    // Frees the slot: the active-slot index only covers processing/confirmed reservations.
    const booking = await client.query(
      `UPDATE crm.booking_requests SET status = 'cancelled', updated_at = now()
        WHERE appointment_id = $1 AND status = 'confirmed' RETURNING id`, [input.appointmentId])
    await logActivity(client, {
      leadId: input.leadId, appointmentId: input.appointmentId, kind: 'meeting_cancelled', actor: input.actor,
      details: { reason, google, bookingRequestReleased: Boolean(booking.rowCount) },
    })
    return { status: 200, outcome: 'cancelled' as const, details: { google } }
  })
}

/* ---------------------------------------------------------- não compareceu */

export type NoShowOutcome = 'marked' | 'already_marked' | 'not_found' | 'not_started' | 'not_markable'

/**
 * Marca falta sem tocar no Google e sem liberar o horário: a reserva continua
 * ocupando o intervalo (que já começou). O contato pode agendar OUTRO horário
 * pelas regras existentes, porque no_show não é reunião ativa.
 */
export async function markNoShow(pool: ConnectablePool, input: {
  leadId: string; appointmentId: string; actor: AdminActor; now?: Date
}): Promise<Result<NoShowOutcome>> {
  return inTransaction(pool, async client => {
    const found = await client.query<{ status: string; starts_at: Date }>(
      'SELECT status, starts_at FROM crm.appointments WHERE id = $1 AND lead_id = $2 FOR UPDATE',
      [input.appointmentId, input.leadId])
    const meeting = found.rows[0]
    if (!meeting) return { status: 404, outcome: 'not_found' as const }
    if (meeting.status === 'no_show') return { status: 200, outcome: 'already_marked' as const }
    if (meeting.status !== 'confirmed') return { status: 409, outcome: 'not_markable' as const }
    if (new Date(meeting.starts_at).getTime() > (input.now ?? new Date()).getTime()) {
      return { status: 409, outcome: 'not_started' as const }
    }
    await client.query(
      `UPDATE crm.appointments SET status = 'no_show', updated_at = now() WHERE id = $1 AND status = 'confirmed'`,
      [input.appointmentId])
    await logActivity(client, {
      leadId: input.leadId, appointmentId: input.appointmentId, kind: 'meeting_no_show', actor: input.actor, details: {},
    })
    return { status: 200, outcome: 'marked' as const }
  })
}

/* ------------------------------------------------------------ classificação */

export type ClassificationOutcome = 'changed' | 'unchanged' | 'not_found'

/** Altera somente o lead; reuniões, contratos e eventos antigos mantêm o valor original. */
export async function setLeadClassification(pool: ConnectablePool, input: {
  leadId: string; isTest: boolean; actor: AdminActor; reason?: unknown
}): Promise<Result<ClassificationOutcome>> {
  return inTransaction(pool, async client => {
    const found = await client.query<{ is_test: boolean }>('SELECT is_test FROM crm.leads WHERE id = $1 FOR UPDATE', [input.leadId])
    const lead = found.rows[0]
    if (!lead) return { status: 404, outcome: 'not_found' as const }
    if (lead.is_test === input.isTest) return { status: 200, outcome: 'unchanged' as const }
    await client.query('UPDATE crm.leads SET is_test = $2, updated_at = now() WHERE id = $1', [input.leadId, input.isTest])
    await logActivity(client, {
      leadId: input.leadId, kind: 'classification_changed', actor: input.actor,
      details: { from: lead.is_test ? 'test' : 'real', to: input.isTest ? 'test' : 'real',
        reason: cleanReason(input.reason), retroactive: false },
    })
    return { status: 200, outcome: 'changed' as const }
  })
}

/* --------------------------------------------------------- reservas travadas */

/** Uma reserva normal termina em segundos; "processing" além disso precisa de conferência. */
export const STUCK_RESERVATION_MINUTES = 15

export type StuckReservation = {
  id: string; leadId: string; leadName: string; company: string | null; isTest: boolean
  startsAt: string; endsAt: string; calendarId: string; createdAt: string; slotPassed: boolean
}

export async function listStuckReservations(pool: ConnectablePool, now?: Date): Promise<StuckReservation[]> {
  return inTransaction(pool, async client => {
    const rows = await client.query<{
      id: string; lead_id: string; full_name: string; company: string | null; is_test: boolean
      starts_at: Date; ends_at: Date; calendar_id: string; created_at: Date; slot_passed: boolean
    }>(
      `WITH ref AS (SELECT COALESCE($1::timestamptz, now()) AS at)
       SELECT b.id, b.lead_id, l.full_name, l.company, l.is_test, b.starts_at, b.ends_at, b.calendar_id, b.created_at,
              b.ends_at <= ref.at AS slot_passed
         FROM crm.booking_requests b JOIN crm.leads l ON l.id = b.lead_id, ref
        WHERE b.status = 'processing' AND b.created_at < ref.at - make_interval(mins => $2::int)
        ORDER BY b.created_at LIMIT 100`,
      [now ? now.toISOString() : null, STUCK_RESERVATION_MINUTES])
    return rows.rows.map(r => ({
      id: r.id, leadId: r.lead_id, leadName: r.full_name, company: r.company, isTest: r.is_test,
      startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
      calendarId: r.calendar_id, createdAt: new Date(r.created_at).toISOString(), slotPassed: r.slot_passed,
    }))
  })
}

export type ReconcileDeps = {
  pool: ConnectablePool
  readGoogleEvent: (calendarId: string, eventId: string) => Promise<GoogleEventState>
}

type StuckRow = { lead_id: string; calendar_id: string; google_event_id: string | null; starts_at: Date; ends_at: Date; submission_id: string }

async function loadStuck(client: PoolClient, bookingId: string, now: Date | undefined, lock: boolean) {
  const found = await client.query<StuckRow>(
    `SELECT lead_id, calendar_id, google_event_id, starts_at, ends_at, submission_id FROM crm.booking_requests
      WHERE id = $1 AND status = 'processing'
        AND created_at < COALESCE($2::timestamptz, now()) - make_interval(mins => $3::int)` + (lock ? ' FOR UPDATE' : ''),
    [bookingId, now ? now.toISOString() : null, STUCK_RESERVATION_MINUTES])
  return found.rows[0] ?? null
}

/** Conferência SOMENTE LEITURA no Google do evento que a reserva pode ter criado. */
export async function inspectStuckReservation(deps: ReconcileDeps, input: { bookingId: string; now?: Date }):
  Promise<Result<'checked' | 'not_stuck' | 'google_unavailable'>> {
  const row = await inTransaction(deps.pool, client => loadStuck(client, input.bookingId, input.now, false))
  if (!row) return { status: 404, outcome: 'not_stuck' }
  try {
    const google = await deps.readGoogleEvent(row.calendar_id, row.google_event_id ?? bookingEventId(input.bookingId))
    return { status: 200, outcome: 'checked', details: { google: google.state } }
  } catch {
    return { status: 503, outcome: 'google_unavailable' }
  }
}

export type ResolveOutcome = 'released' | 'adopted' | 'not_stuck' | 'google_unavailable' | 'google_state_mismatch'

/**
 * Resolve uma reserva travada SOMENTE com base numa conferência feita agora no
 * servidor (nunca no que o navegador informa):
 * - release: só se o Google confirmar que NÃO há evento ativo → reserva "failed", horário liberado;
 * - adopt: só se o Google confirmar evento ativo → registra a reunião confirmada (sem
 *   evento de conversão retroativo) e a reserva vira "confirmed".
 * Nunca apaga registros nem altera o Google.
 */
export async function resolveStuckReservation(deps: ReconcileDeps, input: {
  bookingId: string; decision: 'release' | 'adopt'; actor: AdminActor; now?: Date
}): Promise<Result<ResolveOutcome>> {
  const row = await inTransaction(deps.pool, client => loadStuck(client, input.bookingId, input.now, false))
  if (!row) return { status: 404, outcome: 'not_stuck' }
  const eventId = row.google_event_id ?? bookingEventId(input.bookingId)
  let google: GoogleEventState
  try {
    google = await deps.readGoogleEvent(row.calendar_id, eventId)
  } catch {
    return { status: 503, outcome: 'google_unavailable' }
  }
  const allowed = input.decision === 'release' ? google.state !== 'active' : google.state === 'active'
  if (!allowed) return { status: 409, outcome: 'google_state_mismatch', details: { google: google.state } }

  return inTransaction(deps.pool, async client => {
    const current = await loadStuck(client, input.bookingId, input.now, true)
    if (!current) return { status: 404, outcome: 'not_stuck' as const }
    if (input.decision === 'release') {
      await client.query(
        `UPDATE crm.booking_requests SET status = 'failed', failure_code = 'RECONCILED_NO_GOOGLE_EVENT', updated_at = now()
          WHERE id = $1 AND status = 'processing'`, [input.bookingId])
      await logActivity(client, {
        leadId: current.lead_id, kind: 'booking_reconciled', actor: input.actor,
        details: { bookingRequestId: input.bookingId, decision: 'release', google: google.state },
      })
      return { status: 200, outcome: 'released' as const }
    }
    const meetingUrl = google.state === 'active' ? google.meetingUrl : null
    const appointment = await client.query<{ id: string }>(
      `INSERT INTO crm.appointments (lead_id, calendar_id, starts_at, ends_at, status, calendar_event_id, meeting_url, confirmed_at, is_test)
       VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, now(),
         COALESCE((SELECT l.is_test FROM crm.leads l WHERE l.id = $1), true)) RETURNING id`,
      [current.lead_id, current.calendar_id, current.starts_at, current.ends_at, eventId, meetingUrl])
    await client.query(
      `UPDATE crm.booking_requests SET status = 'confirmed', google_event_id = $2, appointment_id = $3, updated_at = now()
        WHERE id = $1 AND status = 'processing'`, [input.bookingId, eventId, appointment.rows[0].id])
    await logActivity(client, {
      leadId: current.lead_id, appointmentId: appointment.rows[0].id, kind: 'booking_reconciled', actor: input.actor,
      details: { bookingRequestId: input.bookingId, decision: 'adopt', google: google.state, conversionEvent: false },
    })
    return { status: 200, outcome: 'adopted' as const, details: { appointmentId: appointment.rows[0].id } }
  })
}

/* --------------------------------------------------------------- permissões */

/** Regras comuns das rotas administrativas que alteram dados. */
export function authorizeAdminMutation(input: {
  vercelEnv: string | undefined; sessionValid: boolean; originAllowed: boolean; contentType: string | null
}): { status: number; error: string } | null {
  if (input.vercelEnv !== 'preview') return { status: 404, error: 'NOT_FOUND' }
  if (!input.sessionValid) return { status: 401, error: 'UNAUTHORIZED' }
  if (!input.originAllowed) return { status: 403, error: 'FORBIDDEN' }
  if (!input.contentType?.startsWith('application/json')) return { status: 400, error: 'INVALID_REQUEST' }
  return null
}
