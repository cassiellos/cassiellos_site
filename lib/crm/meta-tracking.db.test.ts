/**
 * Meta Pixel / CAPI (preparação) — integração contra PostgreSQL DESCARTÁVEL.
 * Nada é enviado à Meta: verificamos os eventos internos, os event_id devolvidos ao
 * navegador e o payload que a futura CAPI montaria (mesmo nome + mesmo event_id).
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { getBookingForm } from './booking-forms'
import { confirmBookingRequest, type BookingSession } from './booking-confirmation'
import { listBookingSlots } from './booking-slots'
import { saveLeadSubmission } from './lead-intake'
import { buildMetaServerEvent } from './meta-events'
import { leadTrackingEventId } from '../marketing/meta'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const CONSENT = { consent: true, fbp: 'fb.1.1730000000000.1234567890', fbc: 'fb.1.1730000000000.IwAR0abcDEF_123' }

describe('Meta — eventos internos para Pixel e futura CAPI (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 8 }) })
  after(async () => { await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows
  const email = (tag: string) => tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com'

  const submit = (address: string, opts: { isTest?: boolean; marketing?: typeof CONSENT | { consent: false }; key?: string } = {}) =>
    saveLeadSubmission(pool, {
      idempotencyKey: opts.key ?? randomUUID(), name: 'Lead Meta', email: address, phone: '31900000070',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Meta', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: opts.isTest ?? false, bookingMode: 'live',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: 'crm.cassiellos.com.br', challengeTs: null },
      marketing: opts.marketing ?? { consent: false }, eventSourceUrl: ORIGIN + '/agendar/odontologia',
    })

  it('lead NOVO: 1 evento interno "Lead" com event_id estável + consentimento registrado', async () => {
    const r = await submit(email('novo'), { marketing: CONSENT })
    assert.equal(r.leadEventId, leadTrackingEventId(r.leadId))
    assert.equal(r.isTest, false)
    const [ev] = await q<{ event_name: string; source_category: string; event_source_url: string; metadata: Record<string, unknown> }>(
      'SELECT event_name, source_category, event_source_url, metadata FROM crm.tracking_events WHERE event_id = $1', [r.leadEventId])
    assert.deepEqual(ev, { event_name: 'Lead', source_category: 'server', event_source_url: ORIGIN + '/agendar/odontologia',
      metadata: { formSlug: 'odontologia', environment: 'preview', isTest: false, marketingConsent: true } })
    const consents = await q<{ purpose: string; granted: boolean; policy_version: string }>(
      'SELECT purpose, granted, policy_version FROM crm.consents WHERE lead_id = $1 ORDER BY purpose', [r.leadId])
    assert.deepEqual(consents.map(c => c.purpose), ['diagnostic_contact', 'marketing_measurement'])
    const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [r.submissionId])
    assert.deepEqual(sub.answers.marketing, CONSENT)
  })

  it('reenvio do mesmo contato e repetição do mesmo envio NÃO geram novo Lead', async () => {
    const address = email('repetido')
    const key = randomUUID()
    const first = await submit(address, { key })
    const reused = await submit(address, { key })
    const again = await submit(address)
    assert.equal(reused.reused, true)
    assert.equal(again.resubmitted, true)
    assert.equal(again.leadEventId, null)
    assert.equal((await q("SELECT 1 FROM crm.tracking_events WHERE lead_id = $1 AND event_name = 'Lead'", [first.leadId])).length, 1)
  })

  it('sem consentimento: nenhum identificador nem consentimento de marketing guardado', async () => {
    const r = await submit(email('recusa'), { marketing: { consent: false } })
    assert.equal((await q("SELECT 1 FROM crm.consents WHERE lead_id = $1 AND purpose = 'marketing_measurement'", [r.leadId])).length, 0)
    const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [r.submissionId])
    assert.deepEqual(sub.answers.marketing, { consent: false })
  })

  async function confirmFor(leadEmail: string, isTest: boolean, marketing: typeof CONSENT | { consent: false }) {
    const s = await submit(leadEmail, { isTest, marketing })
    const day = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10)
    const slot = [3, 4, 5, 6, 7].map(d => listBookingSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [])).find(x => x.length)![0]
    void day
    const session: BookingSession = { leadId: s.leadId, submissionId: s.submissionId, formSlug: 'odontologia' }
    const r = await confirmBookingRequest({
      pool, verifySession: () => session, getForm: getBookingForm,
      readBusy: async () => [], createEvent: async i => ({ id: 'evt' + i.requestId.replaceAll('-', ''), meetingUrl: null, htmlLink: null }),
      calendarId: 'cal-' + randomUUID(), allowedEmail: leadEmail,
    }, { bookingToken: 'x', startAt: slot.startAt, pageOrigin: ORIGIN })
    return { s, r }
  }

  it('Schedule: o backend devolve o event_id SÓ depois de confirmar a reunião de um lead REAL', async () => {
    const real = await confirmFor(email('agenda.real'), false, CONSENT)
    assert.equal(real.r.status, 201)
    const tracking = real.r.body.tracking as { schedule: { eventName: string; eventId: string } }
    assert.equal(tracking.schedule.eventName, 'Schedule')
    const [ev] = await q<{ event_name: string; metadata: Record<string, unknown> }>(
      'SELECT event_name, metadata FROM crm.tracking_events WHERE event_id = $1', [tracking.schedule.eventId])
    assert.equal(ev.event_name, 'Chronos_Scheduled')
    assert.equal(ev.metadata.isTest, false)
    const test = await confirmFor(email('agenda.teste'), true, CONSENT)
    assert.equal(test.r.status, 201)
    assert.equal('tracking' in test.r.body, false, 'reunião de teste nunca vira conversão')
  })

  it('payload da futura CAPI = mesmo nome e mesmo event_id do Pixel; testes e recusas ficam fora', async () => {
    const { s, r } = await confirmFor(email('capi'), false, CONSENT)
    const eventIds = [s.leadEventId!, (r.body.tracking as { schedule: { eventId: string } }).schedule.eventId]
    const rows = await q<{ event_id: string; event_name: string; occurred_at: Date; event_source_url: string | null; metadata: unknown }>(
      'SELECT event_id, event_name, occurred_at, event_source_url, metadata FROM crm.tracking_events WHERE event_id = ANY($1) ORDER BY event_name', [eventIds])
    const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [s.submissionId])
    const built = rows.map(row => buildMetaServerEvent(row, sub.answers.marketing))
    assert.deepEqual(built.map(b => b.allowed && [b.payload.event_name, b.payload.event_id]),
      [['Schedule', eventIds[1]], ['Lead', eventIds[0]]])
    const noConsent = await confirmFor(email('capi.recusa'), false, { consent: false })
    const [row] = await q<{ event_id: string; event_name: string; occurred_at: Date; event_source_url: string | null; metadata: unknown }>(
      "SELECT event_id, event_name, occurred_at, event_source_url, metadata FROM crm.tracking_events WHERE lead_id = $1 AND event_name = 'Lead'", [noConsent.s.leadId])
    assert.deepEqual(buildMetaServerEvent(row, { consent: false }), { allowed: false, reason: 'no_marketing_consent' })
    assert.equal((await q('SELECT 1 FROM crm.meta_deliveries')).length, 0, 'nada foi enfileirado para envio')
  })
})
