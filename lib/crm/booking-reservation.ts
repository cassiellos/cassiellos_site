import type { PoolClient } from 'pg'

/**
 * Reserva e confirmação de horários do agendamento público (Mini CRM Cassiellos).
 *
 * Regras de reagendamento (Fase 3 / item 3):
 * - Trava transacional por lead: confirmações simultâneas do mesmo contato são
 *   serializadas, então nunca existem duas reservas ativas indevidas.
 * - BLOQUEIA novo agendamento quando o lead possui:
 *     a) uma reserva "processing" cujo horário ainda não terminou; ou
 *     b) uma reunião ativa (pending/confirmed) cujo término (ends_at) ainda
 *        não chegou — inclui reunião em andamento.
 * - PERMITE quando a reunião anterior já terminou, foi concluída, cancelada,
 *   marcada como falta (no_show) ou remarcada. O status "confirmed" sozinho
 *   nunca bloqueia para sempre: vale o horário de término.
 * - Comparações em timestamptz (instante absoluto): independem do fuso da sessão
 *   do banco, do servidor e do visitante.
 * - Mantidos: allowlist de e-mail, chave única por envio (submission_id),
 *   índice único de horário ativo (uq_crm_booking_active_slot) e as
 *   verificações do Google feitas pela rota antes e depois da reserva.
 * - Reuniões anteriores nunca são apagadas nem alteradas; cada novo
 *   agendamento gera seus próprios registros.
 */

/** Status de reunião que ainda ocupam o contato enquanto não terminam. */
export const ACTIVE_APPOINTMENT_STATUSES: readonly string[] = ['pending', 'confirmed']

/** Namespace da trava consultiva por lead (lead-intake usa 241023 por e-mail). */
export const BOOKING_LEAD_LOCK_NAMESPACE = 241025

export type ConnectablePool = { connect(): Promise<PoolClient> }

export type ReserveInput = {
  leadId: string
  submissionId: string
  formSlug: string
  startAt: string
  endAt: string
  calendarId: string
  allowedEmail: string
  /** Somente para testes de borda; em produção usa o relógio do banco (now()). */
  now?: Date
}

export type ReserveResult =
  | { status: 'reserved'; id: string; email: string; company: string }
  | { status: 'already_confirmed'; id: string }
  | { status: 'already_processing' | 'already_failed' | 'bad_submission' |
      'email_not_allowed' | 'slot_unavailable' | 'active_meeting' }

export async function reserveBookingSlot(pool: ConnectablePool, input: ReserveInput): Promise<ReserveResult> {
  const client = await pool.connect()
  let committed = false
  const finish = async <T>(result: T): Promise<T> => {
    await client.query('COMMIT')
    committed = true
    return result
  }
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    // One booking decision at a time per lead (different submissions included).
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [BOOKING_LEAD_LOCK_NAMESPACE, input.leadId])

    const registered = await client.query<{ email: string | null; company: string | null }>(
      `SELECT l.email, l.company
         FROM crm.form_submissions s
         JOIN crm.leads l ON l.id = s.lead_id
         WHERE s.id = $1 AND s.lead_id = $2
           AND s.status = 'validated' AND s.answers ->> 'formSlug' = $3
         FOR UPDATE OF s`,
      [input.submissionId, input.leadId, input.formSlug],
    )
    const lead = registered.rows[0]
    if (!lead) return await finish({ status: 'bad_submission' })
    if (!lead.email || lead.email.toLowerCase() !== input.allowedEmail.toLowerCase()) {
      return await finish({ status: 'email_not_allowed' })
    }

    // Same submission retried: idempotent answer, never a second reservation.
    const found = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM crm.booking_requests WHERE submission_id = $1',
      [input.submissionId],
    )
    if (found.rows[0]) {
      const old = found.rows[0]
      return await finish(old.status === 'confirmed'
        ? { status: 'already_confirmed', id: old.id }
        : { status: old.status === 'processing' ? 'already_processing' : 'already_failed' })
    }

    // Rebooking rule: only what has not ended yet occupies the contact.
    const blocking = await client.query<{ processing: boolean; meeting: boolean }>(
      `WITH ref AS (SELECT COALESCE($2::timestamptz, now()) AS at)
       SELECT
         EXISTS (SELECT 1 FROM crm.booking_requests b, ref
                  WHERE b.lead_id = $1 AND b.status = 'processing'
                    AND b.ends_at > ref.at) AS processing,
         EXISTS (SELECT 1 FROM crm.appointments a, ref
                  WHERE a.lead_id = $1 AND a.status = ANY($3::text[])
                    AND a.ends_at > ref.at) AS meeting`,
      [input.leadId, input.now ? input.now.toISOString() : null, ACTIVE_APPOINTMENT_STATUSES],
    )
    const active = blocking.rows[0]
    if (active?.processing || active?.meeting) return await finish({ status: 'active_meeting' })

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO crm.booking_requests
         (submission_id, lead_id, starts_at, ends_at, calendar_id, status)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, 'processing')
         RETURNING id`,
      [input.submissionId, input.leadId, input.startAt, input.endAt, input.calendarId],
    )
    return await finish({ status: 'reserved', id: inserted.rows[0].id,
      email: lead.email, company: lead.company ?? '' })
  } catch (error) {
    const pgError = error as { code?: string }
    if (pgError.code === '23505') return { status: 'slot_unavailable' }
    throw error
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}

/** Libera a reserva somente se nenhum evento do Google foi criado para ela. */
export async function releaseReservationBeforeGoogle(
  pool: ConnectablePool, bookingId: string, reason: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE crm.booking_requests SET status = 'failed',
         failure_code = $2, updated_at = now()
         WHERE id = $1 AND status = 'processing' AND google_event_id IS NULL`,
      [bookingId, reason],
    )
  } finally {
    client.release()
  }
}

export type FinalizeInput = {
  bookingId: string
  leadId: string
  submissionId: string
  eventId: string
  meetingUrl: string | null
  startAt: string
  endAt: string
  calendarId: string
  formSlug: string
  pageOrigin: string
}

/** Registra a NOVA reunião confirmada; registros anteriores não são tocados. */
export async function finalizeBookingReservation(
  pool: ConnectablePool, input: FinalizeInput,
): Promise<{ appointmentId: string }> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    // The meeting inherits the lead's real/test classification (missing lead -> test).
    const appointment = await client.query<{ id: string; is_test: boolean }>(
      `INSERT INTO crm.appointments (lead_id, calendar_id, starts_at, ends_at,
          status, calendar_event_id, meeting_url, confirmed_at, is_test)
        VALUES ($1, $2, $3::timestamptz, $4::timestamptz,
          'confirmed', $5, $6, now(),
          COALESCE((SELECT l.is_test FROM crm.leads l WHERE l.id = $1), true))
        RETURNING id, is_test`,
      [input.leadId, input.calendarId, input.startAt,
        input.endAt, input.eventId, input.meetingUrl],
    )
    const appointmentId = appointment.rows[0].id
    const isTest = appointment.rows[0].is_test !== false
    await client.query(
      `UPDATE crm.booking_requests SET status = 'confirmed',
          google_event_id = $2, appointment_id = $3, updated_at = now()
        WHERE id = $1 AND status = 'processing'`,
      [input.bookingId, input.eventId, appointmentId],
    )
    await client.query(
      `INSERT INTO crm.lead_activities
         (lead_id, appointment_id, activity_kind, performed_by, details)
         VALUES ($1, $2, 'meeting_scheduled', 'public_booking', $3::jsonb)`,
      [input.leadId, appointmentId, JSON.stringify({
        formSlug: input.formSlug, bookingRequestId: input.bookingId, environment: 'preview', isTest,
      })],
    )
    // Internal event only; Meta CAPI dispatch is a separate, not-yet-enabled pipeline.
    // metadata.isTest is mandatory: only isTest === false may ever be sent to Meta
    // (see isMetaDispatchAllowed in lib/crm/booking-mode.ts).
    await client.query(
      `INSERT INTO crm.tracking_events
         (lead_id, appointment_id, event_id, event_name,
          source_category, event_source_url, action_source, metadata)
         VALUES ($1, $2, $3, 'Chronos_Scheduled', 'server', $4, 'website', $5::jsonb)`,
      [input.leadId, appointmentId,
        'chronos_scheduled_' + input.bookingId.replaceAll('-', ''),
        input.pageOrigin + '/agendar/' + encodeURIComponent(input.formSlug),
        JSON.stringify({ formSlug: input.formSlug, environment: 'preview', isTest })],
    )
    await client.query('COMMIT')
    committed = true
    return { appointmentId }
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}
