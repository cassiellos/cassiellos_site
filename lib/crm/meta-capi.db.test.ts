/**
 * CAPI Schedule contra PostgreSQL DESCARTÁVEL (CRM_INTEGRATION_DATABASE_URL). A Meta é simulada:
 * nenhuma requisição externa, nenhum token real. Verifica a fila crm.meta_deliveries (idempotência,
 * concorrência, status), as travas lidas do banco no momento do envio e a ausência de dados pessoais.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { getBookingForm } from './booking-forms'
import { confirmBookingRequest, type BookingSession } from './booking-confirmation'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from './availability/engine'
import { saveLeadSubmission } from './lead-intake'
import { changeMarketingConsent } from './marketing-consent'
import { claimHomologationEvent } from './meta-homologation-claims'
import { dispatchScheduleToMeta, pgCapiStore, type CapiConfig, type FetchLike } from './meta-capi'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const TOKEN = 'EAAsyntheticTOKENvalue0123456789abcdef'
const IP = '203.0.113.9'
const UA = 'Mozilla/5.0 (synthetic integration agent)'
const LIVE: CapiConfig = { mode: 'live', pixelId: '28992534033707610', accessToken: TOKEN, apiVersion: 'v26.0', testEventCode: null }
const TEST_RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }
const GRANT = { consent: true, decided: true }
const REFUSE = { consent: false, decided: true }

describe('CAPI Schedule — fila e travas no PostgreSQL (Meta simulada)', { skip }, () => {
  let pool: Pool
  // Linhas da fila criadas por esta suíte são removidas ao final: outras suítes esperam a fila vazia.
  const created: string[] = []
  before(() => { pool = new Pool({ connectionString: url, max: 8 }) })
  after(async () => {
    if (created.length) await pool?.query('DELETE FROM crm.meta_deliveries WHERE tracking_event_id = ANY($1::uuid[])', [created])
    await pool?.end()
  })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows
  const email = (tag: string) => tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com'

  async function session(address: string, marketing: typeof GRANT, isTest = false): Promise<BookingSession> {
    const s = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Lead CAPI', email: address, phone: '31987654321',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica CAPI', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: isTest, bookingMode: 'live',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: 'crm.cassiellos.com.br', challengeTs: null },
      marketing, eventSourceUrl: ORIGIN + '/agendar/odontologia',
    })
    return { leadId: s.leadId, submissionId: s.submissionId, formSlug: 'odontologia' }
  }

  async function confirm(s: BookingSession, address: string, nonce?: string) {
    const slot = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], TEST_RULES)).find(x => x.length)![0]
    const r = await confirmBookingRequest({
      pool, verifySession: () => s, getForm: getBookingForm, readBusy: async () => [],
      createEvent: async i => ({ id: 'evt' + i.requestId.replaceAll('-', ''), meetingUrl: null, htmlLink: null }),
      calendarId: 'cal-' + randomUUID(), allowedEmail: address, loadRules: async () => TEST_RULES,
      metaHomologation: nonce ? { claim: input => claimHomologationEvent(pool, { ...input, nonce, actorRef: 'abcdef0123456789' }) } : null,
    }, { bookingToken: 'x', startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201)
    const [row] = await q<{ event_id: string; id: string }>(
      "SELECT t.event_id, t.id FROM crm.tracking_events t WHERE t.lead_id = $1 AND t.event_name = 'Chronos_Scheduled'", [s.leadId])
    created.push(row.id)
    return { response: r, eventId: row.event_id, trackingId: row.id }
  }

  function meta(responses: Array<{ status: number; json?: unknown }>) {
    const bodies: URLSearchParams[] = []
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(new URLSearchParams(init.body))
      const next = responses[Math.min(bodies.length - 1, responses.length - 1)]
      return { status: next.status, json: async () => next.json ?? {} }
    }
    return { fetch, bodies }
  }
  const OK = { status: 200, json: { events_received: 1, fbtrace_id: 'TraceSynthetic1' } }
  const dispatch = (config: CapiConfig, fetch: FetchLike, eventId: string) =>
    dispatchScheduleToMeta({ config, store: pgCapiStore(pool), fetch, sleep: async () => undefined }, { eventId, clientIp: IP, userAgent: UA })
  const delivery = async (trackingId: string) => (await q<{ status: string; attempts: number; payload: Record<string, unknown>; last_http_status: number | null; last_error: string | null; accepted_at: Date | null }>(
    'SELECT status, attempts, payload, last_http_status, last_error, accepted_at FROM crm.meta_deliveries WHERE tracking_event_id = $1', [trackingId]))

  it('lead REAL com consentimento: 1 Schedule aceito, mesmo event_id do navegador, fila sem IP/UA/token', async () => {
    const address = email('capi.real')
    const s = await session(address, GRANT)
    const { response, eventId, trackingId } = await confirm(s, address)
    assert.deepEqual((response.body as { tracking: unknown }).tracking, { schedule: { eventName: 'Schedule', eventId } })
    const m = meta([OK])
    assert.equal((await dispatch(LIVE, m.fetch, eventId)).status, 'accepted')
    assert.equal(JSON.parse(m.bodies[0].get('data')!)[0].event_id, eventId)
    const [row] = await delivery(trackingId)
    assert.equal(row.status, 'accepted')
    assert.equal(row.attempts, 1)
    assert.equal(row.last_http_status, 200)
    assert.ok(row.accepted_at)
    const stored = JSON.stringify(row.payload)
    for (const secret of [TOKEN, IP, UA, address, '31987654321']) assert.equal(stored.includes(secret), false, secret)
    assert.deepEqual((row.payload as { response: unknown }).response, { fbtrace_id: 'TraceSynthetic1', events_received: 1 })
  })

  it('idempotência real: reprocessos e chamadas simultâneas não geram segundo envio', async () => {
    const address = email('capi.dup')
    const s = await session(address, GRANT)
    const { eventId, trackingId } = await confirm(s, address)
    const m = meta([OK])
    const results = await Promise.all([1, 2, 3, 4].map(() => dispatch(LIVE, m.fetch, eventId)))
    assert.equal(results.filter(r => r.status === 'accepted').length, 1)
    assert.equal(results.filter(r => r.status === 'duplicate').length, 3)
    assert.equal(m.bodies.length, 1)
    assert.equal((await dispatch(LIVE, m.fetch, eventId)).status, 'duplicate')
    assert.equal((await delivery(trackingId)).length, 1)
  })

  it('5xx temporário seguido de sucesso: tentativas registradas; abandono após o limite', async () => {
    const address = email('capi.retry')
    const s = await session(address, GRANT)
    const { eventId, trackingId } = await confirm(s, address)
    assert.equal((await dispatch(LIVE, meta([{ status: 503 }, OK]).fetch, eventId)).status, 'accepted')
    const [row] = await delivery(trackingId)
    assert.equal(row.attempts, 2)
    assert.equal(row.status, 'accepted')
    assert.equal(row.last_error, null)

    const address2 = email('capi.down')
    const s2 = await session(address2, GRANT)
    const second = await confirm(s2, address2)
    assert.equal((await dispatch(LIVE, meta([{ status: 500 }]).fetch, second.eventId)).status, 'abandoned')
    const [row2] = await delivery(second.trackingId)
    assert.deepEqual([row2.status, row2.attempts, row2.last_http_status, row2.last_error], ['abandoned', 3, 500, 'http_500'])
    // A reunião permanece confirmada mesmo com a Meta indisponível.
    assert.equal((await q<{ status: string }>(
      'SELECT a.status FROM crm.appointments a JOIN crm.tracking_events t ON t.appointment_id = a.id WHERE t.id = $1', [second.trackingId]))[0].status, 'confirmed')
  })

  it('sem consentimento, consentimento revogado ou reunião cancelada: nada sai e nada é enfileirado', async () => {
    const m = meta([OK])
    const a1 = email('capi.semmkt')
    const noConsent = await confirm(await session(a1, REFUSE), a1)
    assert.deepEqual(await dispatch(LIVE, m.fetch, noConsent.eventId), { status: 'skipped', reason: 'no_marketing_consent' })

    const a2 = email('capi.revoga')
    const s2 = await session(a2, GRANT)
    const revoked = await confirm(s2, a2)
    await changeMarketingConsent(pool, { leadId: s2.leadId, granted: false, source: 'visitor_preferences' })
    assert.deepEqual(await dispatch(LIVE, m.fetch, revoked.eventId), { status: 'skipped', reason: 'no_marketing_consent' })

    const a3 = email('capi.cancel')
    const s3 = await session(a3, GRANT)
    const cancelled = await confirm(s3, a3)
    await pool.query(
      "UPDATE crm.appointments SET status = 'cancelled', cancelled_at = now() WHERE id = (SELECT appointment_id FROM crm.tracking_events WHERE id = $1)",
      [cancelled.trackingId])
    assert.deepEqual(await dispatch(LIVE, m.fetch, cancelled.eventId), { status: 'skipped', reason: 'appointment_not_confirmed' })

    assert.equal(m.bodies.length, 0)
    for (const t of [noConsent, revoked, cancelled]) assert.equal((await delivery(t.trackingId)).length, 0)
  })

  it('lead de TESTE: nunca no fluxo comercial; homologação só com reserva e test_event_code', async () => {
    const m = meta([OK])
    const a1 = email('capi.teste')
    const plain = await confirm(await session(a1, GRANT, true), a1)
    assert.deepEqual(await dispatch(LIVE, m.fetch, plain.eventId), { status: 'skipped', reason: 'test_or_unclassified' })
    assert.equal(m.bodies.length, 0)

    const a2 = email('capi.homolog')
    const nonce = randomUUID().replaceAll('-', '').slice(0, 16)
    const homolog = await confirm(await session(a2, GRANT, true), a2, nonce)
    assert.equal((homolog.response.body as { tracking: { schedule: { homologation?: boolean } } }).tracking.schedule.homologation, true)
    assert.deepEqual(await dispatch(LIVE, m.fetch, homolog.eventId), { status: 'skipped', reason: 'missing_test_event_code' })
    const TEST: CapiConfig = { ...LIVE, mode: 'test', testEventCode: 'TEST93849' }
    assert.equal((await dispatch(TEST, m.fetch, homolog.eventId)).status, 'accepted')
    assert.equal(m.bodies.length, 1)
    assert.equal(m.bodies[0].get('test_event_code'), 'TEST93849')
    assert.equal((await delivery(homolog.trackingId))[0].payload.testEventCode, true)
    // O lead continua marcado como teste.
    assert.equal((await q<{ is_test: boolean }>('SELECT is_test FROM crm.leads l JOIN crm.tracking_events t ON t.lead_id = l.id WHERE t.id = $1', [homolog.trackingId]))[0].is_test, true)
  })
})
