import type { PoolClient } from 'pg'

/**
 * Reserva e confirmação de horários do agendamento público (Mini CRM Cassiellos).
 *
 * Regras de reagendamento (Fase 3 / item 3):
 * - BLOQUEIA novo agendamento quando o contato possui:
 *     a) uma reserva "processing" cujo horário ainda não terminou; ou
 *     b) uma reunião ativa (pending/confirmed) cujo término (ends_at) ainda
 *        não chegou — inclui reunião em andamento.
 * - PERMITE quando a reunião anterior já terminou, foi concluída, cancelada,
 *   marcada como falta (no_show) ou remarcada. O status "confirmed" sozinho
 *   nunca bloqueia para sempre: vale o horário de término.
 * - Comparações em timestamptz (instante absoluto): independem do fuso.
 *
 * Proteção antiabuso (Fase 3 / item 4):
 * - As regras valem por CAIXA DE E-MAIL canônica (canonicalMailbox): variações
 *   como maiúsculas, "+tag" e pontos do Gmail contam como o mesmo e-mail.
 * - Uma reunião futura ativa por e-mail e no máximo 3 agendamentos por e-mail
 *   em 30 dias (reservas processing/confirmed criadas na janela).
 * - Trava transacional por caixa de e-mail: confirmações simultâneas (inclusive
 *   de leads-alias) são serializadas.
 * - Só confirma envios que passaram pela verificação Turnstile no servidor
 *   (answers.protection.turnstile = 'verified'), então chamadas diretas à API
 *   não contornam a proteção.
 * - checkBookingEligibility (somente leitura) roda ANTES de qualquer chamada ao
 *   Google; reserveBookingSlot repete as mesmas regras sob trava.
 * - Mantidos: allowlist, chave única por envio, índice único de horário ativo.
 * - Reuniões anteriores nunca são apagadas nem alteradas.
 */

/** Status de reunião que ainda ocupam o contato enquanto não terminam. */
export const ACTIVE_APPOINTMENT_STATUSES: readonly string[] = ['pending', 'confirmed']

/** Status de reserva contados no limite de 30 dias (falhas antes do Google não contam). */
export const COUNTED_BOOKING_STATUSES: readonly string[] = ['processing', 'confirmed']

export const DEFAULT_BOOKING_LIMITS = { maxBookingsPerMailbox: 3, windowDays: 30 } as const

/** Namespace da trava consultiva por caixa de e-mail (lead-intake usa 241023). */
export const BOOKING_LEAD_LOCK_NAMESPACE = 241025

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

/**
 * Forma canônica do e-mail para as regras antiabuso (NÃO altera o cadastro):
 * minúsculas, sem espaços, sem "+sufixo" e, no Gmail, sem pontos.
 */
export function canonicalMailbox(email: string): string {
  // Mirrors SQL split_part(…, '@', 1|2) exactly (see SQL_CANONICAL_MAILBOX).
  const [localPart = '', domain = ''] = email.trim().toLowerCase().split('@')
  const local = localPart.split('+')[0]
  return GMAIL_DOMAINS.includes(domain)
    ? local.replaceAll('.', '') + '@gmail.com'
    : local + '@' + domain
}

/** Mesma regra de canonicalMailbox, em SQL, aplicada a crm.leads (alias l). */
const SQL_CANONICAL_MAILBOX = `(CASE
  WHEN split_part(lower(trim(l.email)), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower(trim(l.email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
  ELSE split_part(split_part(lower(trim(l.email)), '@', 1), '+', 1) || '@' || split_part(lower(trim(l.email)), '@', 2)
END)`

/** Lista de e-mails isentos SOMENTE do limite de 30 dias (decisão administrativa). */
export function parseLimitExemptMailboxes(raw: string | undefined = process.env.CRM_BOOKING_LIMIT_EXEMPT_EMAILS): string[] {
  return (raw || '').split(',').map(item => item.trim()).filter(item => item.includes('@')).map(canonicalMailbox)
}

export type ConnectablePool = { connect(): Promise<PoolClient> }

export type EligibilityInput = {
  leadId: string
  submissionId: string
  formSlug: string
  allowedEmail: string
  /** Padrão true: só aceita envios verificados pelo Turnstile no servidor. */
  requireVerifiedIntake?: boolean
  /** Só para a consulta de horários: visitantes fora da allowlist ainda podem ver a agenda. */
  skipAllowlist?: boolean
  limits?: { maxBookingsPerMailbox?: number; windowDays?: number; exemptMailboxes?: readonly string[] }
  /** Somente para testes de borda; em produção usa o relógio do banco (now()). */
  now?: Date
}

export type ReserveInput = EligibilityInput & {
  startAt: string
  endAt: string
  calendarId: string
}

type Blocked = { status: 'already_processing' | 'already_failed' | 'bad_submission' |
  'unverified_submission' | 'email_not_allowed' | 'active_meeting' | 'limit_reached' }

export type EligibilityResult =
  | { status: 'eligible'; email: string; company: string }
  | { status: 'already_confirmed'; id: string }
  | Blocked

export type ReserveResult =
  | { status: 'reserved'; id: string; email: string; company: string }
  | { status: 'already_confirmed'; id: string }
  | Blocked
  | { status: 'slot_unavailable' }

async function evaluate(client: PoolClient, input: EligibilityInput, lockSubmission: boolean): Promise<EligibilityResult> {
  const registered = await client.query<{ email: string | null; company: string | null; verified: boolean }>(
    `SELECT l.email, l.company,
            COALESCE(s.answers #>> '{protection,turnstile}' = 'verified', false) AS verified
       FROM crm.form_submissions s
       JOIN crm.leads l ON l.id = s.lead_id
       WHERE s.id = $1 AND s.lead_id = $2
         AND s.status = 'validated' AND s.answers ->> 'formSlug' = $3` +
      (lockSubmission ? ' FOR UPDATE OF s' : ''),
    [input.submissionId, input.leadId, input.formSlug],
  )
  const lead = registered.rows[0]
  if (!lead || !lead.email) return { status: 'bad_submission' }
  if (input.requireVerifiedIntake !== false && !lead.verified) return { status: 'unverified_submission' }
  if (!input.skipAllowlist && lead.email.trim().toLowerCase() !== input.allowedEmail.trim().toLowerCase()) {
    return { status: 'email_not_allowed' }
  }

  // Same submission retried: idempotent answer, never a second reservation.
  const found = await client.query<{ id: string; status: string }>(
    'SELECT id, status FROM crm.booking_requests WHERE submission_id = $1',
    [input.submissionId],
  )
  if (found.rows[0]) {
    const old = found.rows[0]
    return old.status === 'confirmed'
      ? { status: 'already_confirmed', id: old.id }
      : { status: old.status === 'processing' ? 'already_processing' : 'already_failed' }
  }

  // Every rule below applies to ALL leads that share the same canonical mailbox.
  const mailbox = canonicalMailbox(lead.email)
  const limits = { ...DEFAULT_BOOKING_LIMITS, ...input.limits }
  const exempt = (input.limits?.exemptMailboxes ?? []).includes(mailbox)
  const usage = await client.query<{ processing: boolean; meeting: boolean; recent: number }>(
    `WITH ref AS (SELECT COALESCE($2::timestamptz, now()) AS at),
          mailbox AS (SELECT l.id FROM crm.leads l WHERE l.email IS NOT NULL AND ${SQL_CANONICAL_MAILBOX} = $1)
     SELECT
       EXISTS (SELECT 1 FROM crm.booking_requests b, ref
                WHERE b.lead_id IN (SELECT id FROM mailbox) AND b.status = 'processing'
                  AND b.ends_at > ref.at) AS processing,
       EXISTS (SELECT 1 FROM crm.appointments a, ref
                WHERE a.lead_id IN (SELECT id FROM mailbox) AND a.status = ANY($3::text[])
                  AND a.ends_at > ref.at) AS meeting,
       (SELECT count(*)::int FROM crm.booking_requests b, ref
         WHERE b.lead_id IN (SELECT id FROM mailbox) AND b.status = ANY($4::text[])
           AND b.created_at > ref.at - make_interval(days => $5::int)) AS recent`,
    [mailbox, input.now ? input.now.toISOString() : null, ACTIVE_APPOINTMENT_STATUSES,
      COUNTED_BOOKING_STATUSES, limits.windowDays],
  )
  const row = usage.rows[0]
  if (row?.processing || row?.meeting) return { status: 'active_meeting' }
  if (!exempt && (row?.recent ?? 0) >= limits.maxBookingsPerMailbox) return { status: 'limit_reached' }
  return { status: 'eligible', email: lead.email, company: lead.company ?? '' }
}

/**
 * Pré-checagem SOMENTE LEITURA, feita antes de consultar o Google: contatos
 * bloqueados, envios inválidos ou limites atingidos não geram chamadas externas.
 */
export async function checkBookingEligibility(pool: ConnectablePool, input: EligibilityInput): Promise<EligibilityResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query('SET LOCAL statement_timeout = 6000')
    const result = await evaluate(client, input, false)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

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
    const owner = await client.query<{ email: string | null }>(
      'SELECT email FROM crm.leads WHERE id = $1', [input.leadId])
    const email = owner.rows[0]?.email
    if (!email) return await finish({ status: 'bad_submission' })
    // One booking decision at a time per mailbox (alias leads and submissions included).
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [BOOKING_LEAD_LOCK_NAMESPACE, canonicalMailbox(email)])

    const decision = await evaluate(client, input, true)
    if (decision.status !== 'eligible') return await finish(decision)

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO crm.booking_requests
         (submission_id, lead_id, starts_at, ends_at, calendar_id, status)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, 'processing')
         RETURNING id`,
      [input.submissionId, input.leadId, input.startAt, input.endAt, input.calendarId],
    )
    return await finish({ status: 'reserved', id: inserted.rows[0].id,
      email: decision.email, company: decision.company })
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
