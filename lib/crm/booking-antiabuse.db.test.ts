/**
 * Fase 3 / item 4 — testes de integração antiabuso contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL, migrações 0001–0007). Nunca usar o Neon.
 * Google e Cloudflare são simulados: contamos cada chamada para provar que
 * contatos bloqueados não geram nenhuma requisição ao Google.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { getBookingForm } from './booking-forms'
import { checkAvailabilityAccess, confirmBookingRequest, type BookingSession, type ConfirmDeps } from './booking-confirmation'
import { handleLeadIntake } from './booking-intake-request'
import {
  SQL_CANONICAL_MAILBOX, canonicalMailbox, checkBookingEligibility, finalizeBookingReservation, reserveBookingSlot, type ReserveInput,
} from './booking-reservation'
import { type BookingSlot } from './booking-slots'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots } from './availability/engine'
import { saveLeadSubmission, type LeadSubmissionProtection } from './lead-intake'
import { AVAILABILITY_LIMIT, INTAKE_LIMIT, consumeRequestQuota, requestFingerprint } from './request-limits'
import { TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS as K, verifyTurnstileToken, type FetchLike } from './turnstile'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

const HOUR = 3_600_000
const DAY = 24 * HOUR
const VERIFIED: LeadSubmissionProtection = { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null }

type Lead = { leadId: string; submissionId: string; email: string }

function email(tag: string, domain = 'exemplo.com'): string { return tag + '.' + randomUUID().slice(0, 8) + '@' + domain }
function slotAt(ms: number) { return { startAt: new Date(ms).toISOString(), endAt: new Date(ms + 30 * 60_000).toISOString() } }

/** Horários realmente oferecidos pelo motor (dia útil, sem feriado/política, aviso de 12 h, 30 dias). */
function bookableSlots(count: number): BookingSlot[] {
  const result: BookingSlot[] = []
  for (let d = 2; d < 30 && result.length < count; d++) {
    const day = new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
    result.push(...listAvailableSlots(day, [], DEFAULT_AVAILABILITY_RULES).slice(0, Math.max(0, count - result.length)))
  }
  return result
}

function nextSaturday(): string {
  for (let d = 2; d < 9; d++) {
    const day = new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
    if (new Date(day + 'T12:00:00Z').getUTCDay() === 6) return day
  }
  throw new Error('unreachable')
}

describe('Fase 3 / item 4 — antiabuso (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 14 }) })
  after(async () => { await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows
  const calendar = () => 'cal-' + randomUUID()

  async function submit(address: string, protection: LeadSubmissionProtection | null = VERIFIED): Promise<Lead> {
    const r = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Lead Antiabuso', email: address, phone: '31900000030',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Antiabuso', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: true, bookingMode: 'test', protection,
    })
    return { leadId: r.leadId, submissionId: r.submissionId, email: address }
  }
  function reserveInput(lead: Lead, slot: { startAt: string; endAt: string }, cal: string, extra: Partial<ReserveInput> = {}): ReserveInput {
    return { leadId: lead.leadId, submissionId: lead.submissionId, formSlug: 'odontologia', startAt: slot.startAt,
      endAt: slot.endAt, calendarId: cal, allowedEmail: lead.email, ...extra }
  }
  async function book(lead: Lead, slot: { startAt: string; endAt: string }, cal: string, extra: Partial<ReserveInput> = {}) {
    const r = await reserveBookingSlot(pool, reserveInput(lead, slot, cal, extra))
    assert.equal(r.status, 'reserved', 'setup: reserva deveria passar')
    const id = (r as { id: string }).id
    const { appointmentId } = await finalizeBookingReservation(pool, {
      bookingId: id, leadId: lead.leadId, submissionId: lead.submissionId, eventId: 'evt' + randomUUID().replaceAll('-', ''),
      meetingUrl: null, startAt: slot.startAt, endAt: slot.endAt, calendarId: cal, formSlug: 'odontologia',
      pageOrigin: 'https://crm.cassiellos.com.br',
    })
    return { bookingId: id, appointmentId }
  }
  /** Três reuniões passadas e concluídas (contam no limite de 30 dias). */
  async function threePastBookings(address: string, cal: string, alias = (i: number) => address) {
    for (let i = 0; i < 3; i++) {
      const b = await book(await submit(alias(i)), slotAt(Date.now() - (10 - i) * DAY), cal)
      await pool.query("UPDATE crm.appointments SET status = 'completed', completed_at = now() WHERE id = $1", [b.appointmentId])
    }
  }

  describe('regras por caixa de e-mail', () => {
    it('canonicalMailbox (JS) e a expressão SQL produzem o mesmo resultado', async () => {
      const samples = ['A.B+x@Gmail.com', 'a.b+y@googlemail.com', 'Maria+1@Clinica.com.br', 'maria.souza@clinica.com.br',
        '  Spaces@Exemplo.com', 'plain@exemplo.com', 'x+@gmail.com', 'UPPER.Case+Tag@Outlook.COM',
        'ma.ri_a-x+news@Proton.me', 'p.q+r@pm.me', 'f.g+h@fastmail.com', 'maria-a@yahoo.com', 'i.j+k@icloud.com']
      const leads: string[] = []
      for (const s of samples) {
        const [row] = await q<{ id: string }>(`INSERT INTO crm.leads (full_name, email, stage, is_test) VALUES ('Canon', $1, 'new', true) RETURNING id`,
          [s.replace('@', '.' + randomUUID().slice(0, 4) + '@')])
        leads.push(row.id)
      }
      // Uses the exact production expression (exported), not a copy.
      const rows = await q<{ email: string; canon: string }>(`SELECT l.email, ${SQL_CANONICAL_MAILBOX} AS canon
        FROM crm.leads l WHERE l.id = ANY($1::uuid[])`, [leads])
      assert.equal(rows.length, samples.length)
      for (const row of rows) assert.equal(row.canon, canonicalMailbox(row.email), row.email)
    })

    it('uma reunião futura ativa por e-mail: aliases (+tag, pontos do Gmail, maiúsculas) também são bloqueados', async () => {
      const base = 'maria.alias' + randomUUID().slice(0, 6)
      const cal = calendar()
      await book(await submit(base + '@gmail.com'), slotAt(Date.now() + 3 * DAY), cal)
      for (const alias of [base.replace('.', '') + '@gmail.com', base + '+promo@gmail.com', base.toUpperCase() + '@Gmail.com']) {
        const lead = await submit(alias)
        const r = await reserveBookingSlot(pool, reserveInput(lead, slotAt(Date.now() + 5 * DAY), cal))
        assert.deepEqual(r, { status: 'active_meeting' }, alias)
      }
      // Fase 3.4: other domains are never unified with Gmail.
      const other = await submit(base + '@googlemail.com')
      assert.equal((await reserveBookingSlot(pool, reserveInput(other, slotAt(Date.now() + 6 * DAY), cal))).status, 'reserved')
    })

    it('provedores sem regra documentada: +sufixo identifica OUTRO contato (sem unificação indevida)', async () => {
      const base = 'corp' + randomUUID().slice(0, 6)
      const cal = calendar()
      for (const [i, domain] of ['clinica-exemplo.com.br', 'outlook.com'].entries()) {
        await book(await submit(base + '@' + domain), slotAt(Date.now() + (3 + i) * DAY), cal)
        const plus = await submit(base + '+agenda@' + domain)
        assert.equal((await reserveBookingSlot(pool, reserveInput(plus, slotAt(Date.now() + (8 + i) * DAY), cal))).status,
          'reserved', domain)
      }
    })

    it('máximo de 3 agendamentos por e-mail em 30 dias (4º bloqueado, resposta genérica)', async () => {
      const address = email('limite')
      const cal = calendar()
      await threePastBookings(address, cal)
      const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotAt(Date.now() + 3 * DAY), cal))
      assert.deepEqual(r, { status: 'limit_reached' })
      assert.equal((await q("SELECT 1 FROM crm.booking_requests WHERE lead_id = (SELECT id FROM crm.leads WHERE email = $1)", [address])).length, 3)
    })

    it('o limite soma aliases do mesmo e-mail', async () => {
      const base = 'soma' + randomUUID().slice(0, 6)
      const cal = calendar()
      await threePastBookings(base + '@gmail.com', cal, i => base.slice(0, 2) + '.' + base.slice(2) + '+' + i + '@gmail.com')
      const r = await reserveBookingSlot(pool, reserveInput(await submit(base + '@gmail.com'), slotAt(Date.now() + 3 * DAY), cal))
      assert.equal(r.status, 'limit_reached')
    })

    it('reservas com falha antes do Google e agendamentos com mais de 30 dias não contam', async () => {
      const address = email('janela')
      const cal = calendar()
      await threePastBookings(address, cal)
      // Booking made 31 days ago leaves the window.
      await pool.query(`UPDATE crm.booking_requests SET created_at = now() - interval '31 days'
        WHERE id = (SELECT id FROM crm.booking_requests WHERE lead_id = (SELECT id FROM crm.leads WHERE email = $1) ORDER BY created_at LIMIT 1)`, [address])
      const lead = await submit(address)
      const fourth = await reserveBookingSlot(pool, reserveInput(lead, slotAt(Date.now() + 3 * DAY), cal))
      assert.equal(fourth.status, 'reserved')
      await pool.query("UPDATE crm.booking_requests SET status = 'failed' WHERE id = $1", [(fourth as { id: string }).id])
      const fifth = await reserveBookingSlot(pool, reserveInput(await submit(address), slotAt(Date.now() + 4 * DAY), cal))
      assert.equal(fifth.status, 'reserved', 'a reserva com falha não consumiu o limite')
    })

    it('limite de 30 dias respeita o instante exato (fronteira)', async () => {
      const address = email('fronteira')
      const cal = calendar()
      await threePastBookings(address, cal)
      const [{ oldest }] = await q<{ oldest: Date }>(`SELECT min(created_at) AS oldest FROM crm.booking_requests
        WHERE lead_id = (SELECT id FROM crm.leads WHERE email = $1)`, [address])
      const lead = await submit(address)
      const at = (ms: number) => ({ now: new Date(ms) })
      // JS Date has millisecond precision (PostgreSQL keeps microseconds): ±1 ms around the edge.
      assert.equal((await checkBookingEligibility(pool, { ...reserveInput(lead, slotAt(0), cal), ...at(oldest.getTime() + 30 * DAY - 1) })).status, 'limit_reached')
      assert.equal((await checkBookingEligibility(pool, { ...reserveInput(lead, slotAt(0), cal), ...at(oldest.getTime() + 30 * DAY + 1) })).status, 'eligible')
    })

    it('isenção administrativa vale só para o limite de 30 dias, nunca para reunião ativa', async () => {
      const address = email('isento')
      const cal = calendar()
      await threePastBookings(address, cal)
      const limits = { exemptMailboxes: [canonicalMailbox(address)] }
      const lead = await submit(address)
      const r = await reserveBookingSlot(pool, reserveInput(lead, slotAt(Date.now() + 3 * DAY), cal, { limits }))
      assert.equal(r.status, 'reserved')
      const again = await reserveBookingSlot(pool, reserveInput(await submit(address), slotAt(Date.now() + 4 * DAY), cal, { limits }))
      assert.equal(again.status, 'active_meeting')
    })

    it('envio sem verificação Turnstile no servidor não pode confirmar (chamada direta à API)', async () => {
      const address = email('sem.turnstile')
      const unverified = await submit(address, null)
      const r = await reserveBookingSlot(pool, reserveInput(unverified, slotAt(Date.now() + 3 * DAY), calendar()))
      assert.deepEqual(r, { status: 'unverified_submission' })
      // JSON forjado com outro valor também não passa.
      await pool.query(`UPDATE crm.form_submissions SET answers = jsonb_set(answers, '{protection}', '{"turnstile":"skipped"}') WHERE id = $1`, [unverified.submissionId])
      assert.equal((await reserveBookingSlot(pool, reserveInput(unverified, slotAt(Date.now() + 3 * DAY), calendar()))).status, 'unverified_submission')
      const verified = await submit(address)
      assert.equal((await reserveBookingSlot(pool, reserveInput(verified, slotAt(Date.now() + 3 * DAY), calendar()))).status, 'reserved')
    })

    it('pré-checagem é somente leitura (nenhuma linha criada)', async () => {
      const lead = await submit(email('leitura'))
      assert.equal((await checkBookingEligibility(pool, reserveInput(lead, slotAt(0), calendar()))).status, 'eligible')
      const address = email('leitura.bloqueado')
      await book(await submit(address), slotAt(Date.now() + 3 * DAY), calendar())
      const blockedLead = await submit(address)
      assert.equal((await checkBookingEligibility(pool, reserveInput(blockedLead, slotAt(0), calendar()))).status, 'active_meeting')
      for (const submissionId of [lead.submissionId, blockedLead.submissionId]) {
        assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE submission_id = $1', [submissionId])).length, 0)
      }
      assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [lead.leadId])).length, 0)
      assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [blockedLead.leadId])).length, 1, 'só a reserva original')
    })

    it('confirmações simultâneas de aliases do mesmo e-mail: apenas 1 reserva', async () => {
      const base = 'corrida' + randomUUID().slice(0, 6)
      const cal = calendar()
      const leads: Lead[] = []
      for (let i = 0; i < 6; i++) leads.push(await submit(base + '+' + i + '@gmail.com'))
      const results = await Promise.all(leads.map((lead, i) =>
        reserveBookingSlot(pool, reserveInput(lead, slotAt(Date.now() + (3 + i) * DAY), cal))))
      assert.equal(results.filter(r => r.status === 'reserved').length, 1)
      assert.equal(results.filter(r => r.status === 'active_meeting').length, 5)
    })
  })

  describe('confirmBookingRequest — nenhuma chamada indevida ao Google', () => {
    function google(opts: { busy?: { start: string; end: string }[]; busyOnRecheck?: { start: string; end: string }[] } = {}) {
      const calls = { readBusy: 0, createEvent: 0 }
      return {
        calls,
        readBusy: async () => {
          calls.readBusy++
          return calls.readBusy > 1 && opts.busyOnRecheck ? opts.busyOnRecheck : (opts.busy ?? [])
        },
        createEvent: async (input: { requestId: string }) => {
          calls.createEvent++
          return { id: 'evt' + input.requestId.replaceAll('-', ''), meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc', htmlLink: null }
        },
      }
    }
    function deps(g: ReturnType<typeof google>, allowedEmail: string, extra: Partial<ConfirmDeps> = {}): ConfirmDeps {
      return {
        pool, verifySession: token => (token && typeof token === 'object' ? token as BookingSession : null),
        getForm: getBookingForm, readBusy: g.readBusy, createEvent: g.createEvent,
        calendarId: calendar(), allowedEmail, ...extra,
      }
    }
    const session = (lead: Lead): BookingSession => ({ leadId: lead.leadId, submissionId: lead.submissionId, formSlug: 'odontologia' })
    const ORIGIN = 'https://crm.cassiellos.com.br'

    it('fluxo válido: 2 consultas ao Google (antes e depois da reserva) e 1 evento', async () => {
      const lead = await submit(email('fluxo'))
      const g = google()
      const [slot] = bookableSlots(1)
      const r = await confirmBookingRequest(deps(g, lead.email), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.equal(r.status, 201)
      assert.deepEqual(g.calls, { readBusy: 2, createEvent: 1 })
    })

    it('contato com reunião ativa: 409 genérico, zero chamadas ao Google', async () => {
      const address = email('ativa')
      const d0 = deps(google(), address)
      await book(await submit(address), slotAt(Date.now() + 5 * DAY), d0.calendarId)
      const lead = await submit(address)
      const g = google()
      const [slot] = bookableSlots(1)
      const r = await confirmBookingRequest(deps(g, address), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 409, body: { error: 'CONTACT_HAS_ACTIVE_MEETING' } })
      assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
    })

    it('limite por e-mail atingido: 429 genérico, zero chamadas ao Google', async () => {
      const address = email('limite.google')
      await threePastBookings(address, calendar())
      const lead = await submit(address)
      const g = google()
      const [slot] = bookableSlots(1)
      const r = await confirmBookingRequest(deps(g, address), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 429, body: { error: 'BOOKING_LIMIT_REACHED' } })
      assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
    })

    it('allowlist preservada: e-mail fora da lista não consulta o Google', async () => {
      const lead = await submit(email('fora.allowlist'))
      const g = google()
      const [slot] = bookableSlots(1)
      const r = await confirmBookingRequest(deps(g, 'autorizado@exemplo.com'), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 403, body: { error: 'TEST_EMAIL_NOT_ALLOWED' } })
      assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
    })

    it('envio não verificado, sessão inválida e horário inválido: zero chamadas ao Google', async () => {
      const unverified = await submit(email('nao.verificado'), null)
      const [slot] = bookableSlots(1)
      for (const [token, startAt, expected] of [
        [session(unverified), slot.startAt, 'BOOKING_SESSION_EXPIRED'],
        [null, slot.startAt, 'BOOKING_SESSION_EXPIRED'],
        [session(unverified), '2026-13-40T99:00:00Z', 'INVALID_SLOT'],
        // Módulo de disponibilidade: dia fechado pelas regras (sábado) = SLOT_UNAVAILABLE (409), sem Google.
        [session(unverified), nextSaturday() + 'T13:00:00.000Z', 'SLOT_UNAVAILABLE'],
      ] as const) {
        const g = google()
        const r = await confirmBookingRequest(deps(g, unverified.email), { bookingToken: token, startAt, pageOrigin: ORIGIN })
        assert.equal(r.body.error, expected)
        assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
      }
    })

    it('horário ocupado no Google: 409, nenhuma reserva e nenhum evento', async () => {
      const lead = await submit(email('ocupado.google'))
      const [slot] = bookableSlots(1)
      const g = google({ busy: [{ start: slot.startAt, end: slot.endAt }] })
      const r = await confirmBookingRequest(deps(g, lead.email), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 409, body: { error: 'SLOT_UNAVAILABLE' } })
      assert.deepEqual(g.calls, { readBusy: 1, createEvent: 0 })
      assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [lead.leadId])).length, 0)
    })

    it('conflito na segunda checagem do Google: reserva liberada (failed), nenhum evento', async () => {
      const lead = await submit(email('reconfere'))
      const [slot] = bookableSlots(1)
      const g = google({ busyOnRecheck: [{ start: slot.startAt, end: slot.endAt }] })
      const r = await confirmBookingRequest(deps(g, lead.email), { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.equal(r.body.error, 'SLOT_UNAVAILABLE')
      assert.deepEqual(g.calls, { readBusy: 2, createEvent: 0 })
      const [row] = await q<{ status: string; failure_code: string }>('SELECT status, failure_code FROM crm.booking_requests WHERE lead_id = $1', [lead.leadId])
      assert.deepEqual(row, { status: 'failed', failure_code: 'EXTERNAL_CALENDAR_CONFLICT' })
    })

    it('agendamentos simultâneos do mesmo e-mail: exatamente 1 evento criado', async () => {
      const address = email('simultaneo.google')
      const leads: Lead[] = []
      for (let i = 0; i < 5; i++) leads.push(await submit(address))
      const g = google()
      const slots = bookableSlots(5)
      const shared = deps(g, address)
      const results = await Promise.all(leads.map((lead, i) =>
        confirmBookingRequest(shared, { bookingToken: session(lead), startAt: slots[i].startAt, pageOrigin: ORIGIN })))
      assert.equal(results.filter(r => r.status === 201).length, 1)
      assert.equal(g.calls.createEvent, 1)
      for (const r of results.filter(x => x.status !== 201)) assert.equal(r.body.error, 'CONTACT_HAS_ACTIVE_MEETING')
    })

    it('mesmo envio repetido após confirmar: resposta idempotente sem tocar o Google', async () => {
      const lead = await submit(email('repetido'))
      const [slot] = bookableSlots(1)
      const shared = deps(google(), lead.email)
      await confirmBookingRequest(shared, { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      const g = google()
      const r = await confirmBookingRequest({ ...shared, readBusy: g.readBusy, createEvent: g.createEvent },
        { bookingToken: session(lead), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.equal(r.status, 200)
      assert.equal(r.body.alreadyConfirmed, true)
      assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
    })

    it('consulta de horários exige sessão e bloqueia cedo contatos ativos/limitados', async () => {
      const ok = await submit(email('agenda.ok'))
      assert.equal(await checkAvailabilityAccess(pool, session(ok), 'odontologia'), null, 'fora da allowlist ainda pode ver a agenda')
      assert.deepEqual(await checkAvailabilityAccess(pool, null, 'odontologia'), { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } })
      assert.deepEqual(await checkAvailabilityAccess(pool, { ...session(ok), formSlug: 'outro' }, 'odontologia'), { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } })
      const unverified = await submit(email('agenda.sem'), null)
      assert.deepEqual(await checkAvailabilityAccess(pool, session(unverified), 'odontologia'), { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } })
      const address = email('agenda.ativa')
      await book(await submit(address), slotAt(Date.now() + 5 * DAY), calendar())
      assert.deepEqual(await checkAvailabilityAccess(pool, session(await submit(address)), 'odontologia'), { status: 409, body: { error: 'CONTACT_HAS_ACTIVE_MEETING' } })
      const limited = email('agenda.limite')
      await threePastBookings(limited, calendar())
      assert.deepEqual(await checkAvailabilityAccess(pool, session(await submit(limited)), 'odontologia'), { status: 429, body: { error: 'BOOKING_LIMIT_REACHED' } })
    })
  })

  describe('cadastro → sessão → confirmação (Turnstile com chaves oficiais de teste)', () => {
    const siteverify = (override: Record<string, unknown> = {}): FetchLike => async (_u, init) => {
      const b = JSON.parse(init.body)
      const data = b.secret === K.secretAlwaysPasses && b.response === K.dummyToken
        ? { success: true, hostname: 'crm.cassiellos.com.br', action: TURNSTILE_BOOKING_ACTION, challenge_ts: new Date().toISOString() }
        : { success: false, 'error-codes': ['invalid-input-response'] }
      return { ok: true, status: 200, json: async () => ({ ...data, ...override }) }
    }
    function intakeDeps(fetchImpl: FetchLike) {
      return {
        getForm: getBookingForm,
        turnstileConfig: { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretAlwaysPasses, usingTestKeys: true } as const,
        expectedHostnames: ['crm.cassiellos.com.br'],
        verifyTurnstile: ({ token, secretKey, remoteIp }: { token: unknown; secretKey: string; remoteIp: string | null }) =>
          verifyTurnstileToken({ token, secretKey, remoteIp, expectedAction: TURNSTILE_BOOKING_ACTION, expectedHostnames: ['crm.cassiellos.com.br'], fetchImpl }),
        consumeIpQuota: async () => true,
        saveLead: (input: Parameters<typeof saveLeadSubmission>[1]) => saveLeadSubmission(pool, input),
        createGrant: (data: BookingSession) => JSON.stringify(data),
        classifyNewLeadAsTest: () => true,
        bookingMode: 'test',
      }
    }
    const form = (address: string, token: string) => ({
      formSlug: 'odontologia', idempotencyKey: randomUUID(), name: 'Lead Fluxo', email: address, whatsapp: '31900000040',
      answers: { clinic: 'Clínica Fluxo', revenue: 'Ainda não faturo', priority: 'Atrair mais pacientes' },
      attribution: {}, privacyAccepted: true, turnstileToken: token,
    })

    it('token rejeitado não grava nada; token válido grava envio verificado e permite confirmar', async () => {
      const address = email('fluxo.completo')
      const bad = await handleLeadIntake(intakeDeps(siteverify()), { value: form(address, 'token-forjado'), remoteIp: null })
      assert.equal(bad.status, 403)
      assert.equal((await q('SELECT 1 FROM crm.leads WHERE email = $1', [address])).length, 0)
      const good = await handleLeadIntake(intakeDeps(siteverify()), { value: form(address, K.dummyToken), remoteIp: null })
      assert.equal(good.status, 201)
      const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [good.body.submissionId])
      assert.equal(sub.answers.protection.turnstile, 'verified')
      assert.equal(JSON.stringify(sub.answers).includes(K.dummyToken), false, 'o token não é armazenado')
      const calls = { readBusy: 0, createEvent: 0 }
      const [slot] = bookableSlots(1)
      const r = await confirmBookingRequest({
        pool, verifySession: t => JSON.parse(String(t)), getForm: getBookingForm,
        readBusy: async () => { calls.readBusy++; return [] },
        createEvent: async i => { calls.createEvent++; return { id: 'evt' + i.requestId.replaceAll('-', ''), meetingUrl: null, htmlLink: null } },
        calendarId: calendar(), allowedEmail: address,
      }, { bookingToken: good.body.bookingToken, startAt: slot.startAt, pageOrigin: 'https://crm.cassiellos.com.br' })
      assert.equal(r.status, 201)
      assert.deepEqual(calls, { readBusy: 2, createEvent: 1 })
    })

    it('lead existente (cadastro anterior sem verificação) continua compatível com novo envio verificado', async () => {
      const address = email('legado')
      const [legacy] = await q<{ id: string }>(`INSERT INTO crm.leads (full_name, email, whatsapp, company, segment, stage, is_test)
        VALUES ('Lead Legado', $1, '31900000050', 'Clínica Legada', 'Clínicas odontológicas', 'contacted', true) RETURNING id`, [address])
      const [old] = await q<{ id: string }>(`INSERT INTO crm.form_submissions (lead_id, form_version, answers, idempotency_key, status)
        VALUES ($1, 'odontologia-v1', $2::jsonb, $3, 'validated') RETURNING id`,
      [legacy.id, JSON.stringify({ niche: 'Clínicas odontológicas', formSlug: 'odontologia', questions: {}, attribution: {} }), randomUUID()])
      const oldLead: Lead = { leadId: legacy.id, submissionId: old.id, email: address }
      assert.equal((await reserveBookingSlot(pool, reserveInput(oldLead, slotAt(Date.now() + 3 * DAY), calendar()))).status, 'unverified_submission')
      const r = await handleLeadIntake(intakeDeps(siteverify()), { value: form(address, K.dummyToken), remoteIp: null })
      assert.equal(r.body.leadId, legacy.id, 'mesmo lead, cadastro preservado')
      const fresh: Lead = { leadId: legacy.id, submissionId: String(r.body.submissionId), email: address }
      assert.equal((await reserveBookingSlot(pool, reserveInput(fresh, slotAt(Date.now() + 3 * DAY), calendar()))).status, 'reserved')
      const [lead] = await q('SELECT full_name, stage FROM crm.leads WHERE id = $1', [legacy.id])
      assert.deepEqual(lead, { full_name: 'Lead Legado', stage: 'contacted' })
    })
  })

  describe('limites por IP (preservados)', () => {
    const SECRET = 'ab'.repeat(32)

    it('cadastro: 10 por hora por IP; o 11º é recusado; outro IP não é afetado; janela reinicia', async () => {
      const ip = '198.51.100.' + Math.floor(Math.random() * 200)
      const fp = requestFingerprint(INTAKE_LIMIT, ip, SECRET)!
      const results: boolean[] = []
      for (let i = 0; i < 11; i++) results.push(await consumeRequestQuota(pool, INTAKE_LIMIT, fp))
      assert.deepEqual(results, [...Array(10).fill(true), false])
      assert.equal(await consumeRequestQuota(pool, INTAKE_LIMIT, requestFingerprint(INTAKE_LIMIT, ip + '1', SECRET)!), true)
      await pool.query("UPDATE crm.booking_intake_limits SET window_started_at = now() - interval '61 minutes' WHERE fingerprint = $1", [fp])
      assert.equal(await consumeRequestQuota(pool, INTAKE_LIMIT, fp), true)
      assert.equal((await q('SELECT 1 FROM crm.booking_intake_limits WHERE fingerprint = $1', [ip])).length, 0, 'o IP nunca é gravado')
    })

    it('consulta de horários: 50 a cada 15 minutos por IP', async () => {
      const fp = requestFingerprint(AVAILABILITY_LIMIT, '192.0.2.' + Math.floor(Math.random() * 200), SECRET)!
      let allowed = 0
      for (let i = 0; i < 51; i++) if (await consumeRequestQuota(pool, AVAILABILITY_LIMIT, fp)) allowed++
      assert.equal(allowed, 50)
    })

    it('sem segredo configurado não há impressão digital (rota falha fechada)', () => {
      assert.equal(requestFingerprint(INTAKE_LIMIT, '203.0.113.1', ''), null)
      assert.equal(requestFingerprint(INTAKE_LIMIT, '203.0.113.1', 'curto'), null)
      assert.notEqual(requestFingerprint(INTAKE_LIMIT, '203.0.113.1', SECRET), requestFingerprint(AVAILABILITY_LIMIT, '203.0.113.1', SECRET))
    })
  })
})
