/**
 * Meta Pixel / CAPI (preparação) + consentimento de marketing — integração contra PostgreSQL DESCARTÁVEL.
 * Nada é enviado à Meta: verificamos eventos internos, event_id devolvidos ao navegador, o
 * estado auditável do consentimento (revogação) e a decisão C2 (fbp/fbc nunca gravados).
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { getBookingForm } from './booking-forms'
import { confirmBookingRequest, type BookingSession } from './booking-confirmation'
import { handleMarketingConsentChange } from './booking-consent-request'
import { handleLeadIntake, type IntakeDeps } from './booking-intake-request'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from './availability/engine'
import { MARKETING_POLICY_VERSION, saveLeadSubmission } from './lead-intake'
import { changeMarketingConsent, readMarketingConsentState } from './marketing-consent'
import { buildMetaServerEvent } from './meta-events'
import { TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS as K, verifyTurnstileToken, type FetchLike } from './turnstile'
import { leadTrackingEventId } from '../marketing/meta'
import { serializeConsent } from '../privacy/consent'

const TEST_RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const HOST = 'crm.cassiellos.com.br'
const FBP = 'fb.1.1730000000000.1234567890'
const FBC = 'fb.1.1730000000000.IwAR0abcDEF_123'
const GRANT = { consent: true, decided: true }
const REFUSE = { consent: false, decided: true }
const NO_CHOICE = { consent: false, decided: false }
type Choice = typeof GRANT

describe('Meta — eventos, consentimento e revogação (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 8 }) })
  after(async () => { await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows
  const email = (tag: string) => tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com'

  const submit = (address: string, opts: { isTest?: boolean; marketing?: Choice; key?: string } = {}) =>
    saveLeadSubmission(pool, {
      idempotencyKey: opts.key ?? randomUUID(), name: 'Lead Meta', email: address, phone: '31900000070',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Meta', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: opts.isTest ?? false, bookingMode: 'live',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: HOST, challengeTs: null },
      marketing: opts.marketing ?? NO_CHOICE, eventSourceUrl: ORIGIN + '/agendar/odontologia',
    })

  /** Pipeline real navegador → handler → banco (Siteverify simulado com as chaves oficiais de teste). */
  function intakeDeps(opts: { isTest?: boolean } = {}): IntakeDeps {
    const siteverify: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({
      success: true, hostname: HOST, action: TURNSTILE_BOOKING_ACTION, challenge_ts: new Date().toISOString() }) })
    return {
      getForm: getBookingForm,
      turnstileConfig: { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretAlwaysPasses, usingTestKeys: true },
      expectedHostnames: [HOST],
      verifyTurnstile: ({ token, secretKey, remoteIp }) => verifyTurnstileToken({ token, secretKey, remoteIp,
        expectedAction: TURNSTILE_BOOKING_ACTION, expectedHostnames: [HOST], fetchImpl: siteverify }),
      consumeIpQuota: async () => true,
      saveLead: input => saveLeadSubmission(pool, input),
      createGrant: data => 'grant:' + data.submissionId,
      classifyNewLeadAsTest: () => opts.isTest === true,
      bookingMode: 'live',
      publicOrigin: ORIGIN,
      log: () => undefined,
    }
  }

  async function sessionFor(leadEmail: string, marketing: Choice, isTest = false): Promise<BookingSession & { leadEventId: string | null }> {
    const s = await submit(leadEmail, { marketing, isTest })
    return { leadId: s.leadId, submissionId: s.submissionId, formSlug: 'odontologia', leadEventId: s.leadEventId ?? null }
  }
  const visitorChange = (session: BookingSession, marketing: unknown) =>
    handleMarketingConsentChange({ pool, verifySession: () => session }, { bookingToken: 'sessao', marketing })
  const leadSnapshot = async (leadId: string) => (await q(
    'SELECT full_name, email, whatsapp, company, segment, stage, is_test, updated_at FROM crm.leads WHERE id = $1', [leadId]))[0]

  it('C2: o navegador manda fbp/fbc, mas NADA disso chega ao banco (só sim/não)', async () => {
    const address = email('c2')
    // The consent cookie of the request confirms the choice (server-side validation, G2).
    const r = await handleLeadIntake(intakeDeps(), { remoteIp: null, cookieHeader: 'cassiellos_consent=' + serializeConsent({ analytics: null, marketing: true }), value: {
      formSlug: 'odontologia', idempotencyKey: randomUUID(), name: 'Lead C2', email: address, whatsapp: '(31) 90000-0071',
      answers: { clinic: 'Clínica C2', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, privacyAccepted: true, turnstileToken: K.dummyToken,
      marketing: { consent: true, decided: true, fbp: FBP, fbc: FBC },
    } })
    assert.equal(r.status, 201)
    const rows = await q<{ answers: Record<string, unknown>; lead_id: string }>(
      `SELECT s.answers, s.lead_id FROM crm.form_submissions s JOIN crm.leads l ON l.id = s.lead_id WHERE l.email = $1`, [address])
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].answers.marketing, { consent: true, decided: true })
    const everything = JSON.stringify(await q(
      `SELECT (SELECT json_agg(s.answers) FROM crm.form_submissions s WHERE s.lead_id = $1) AS s,
              (SELECT json_agg(t) FROM crm.tracking_events t WHERE t.lead_id = $1) AS t,
              (SELECT json_agg(c) FROM crm.consents c WHERE c.lead_id = $1) AS c,
              (SELECT json_agg(a) FROM crm.lead_activities a WHERE a.lead_id = $1) AS a`, [rows[0].lead_id]))
    for (const id of [FBP, FBC, 'fb.1.']) assert.equal(everything.includes(id), false, id + ' não pode estar no banco')
    assert.deepEqual(r.body.tracking, { lead: { eventName: 'Lead', eventId: leadTrackingEventId(rows[0].lead_id) } })
  })

  it('lead NOVO com aceite: 1 evento "Lead" + consentimento com a versão única das políticas', async () => {
    const r = await submit(email('novo'), { marketing: GRANT })
    assert.equal(r.leadEventId, leadTrackingEventId(r.leadId))
    const [ev] = await q<{ event_name: string; metadata: Record<string, unknown> }>(
      'SELECT event_name, metadata FROM crm.tracking_events WHERE event_id = $1', [r.leadEventId])
    assert.deepEqual(ev, { event_name: 'Lead',
      metadata: { formSlug: 'odontologia', environment: 'preview', isTest: false, marketingConsent: true } })
    const consents = await q<{ purpose: string; granted: boolean; policy_version: string }>(
      'SELECT purpose, granted, policy_version FROM crm.consents WHERE lead_id = $1 ORDER BY purpose', [r.leadId])
    assert.deepEqual(consents, [
      { purpose: 'diagnostic_contact', granted: true, policy_version: MARKETING_POLICY_VERSION },
      { purpose: 'marketing_measurement', granted: true, policy_version: MARKETING_POLICY_VERSION },
    ])
    assert.equal((await readMarketingConsentState(pool, r.leadId)).granted, true)
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

  it('cadastro SEM marketing: grava normalmente, sem consentimento de marketing', async () => {
    for (const choice of [REFUSE, NO_CHOICE]) {
      const r = await submit(email('recusa'), { marketing: choice })
      assert.equal((await q("SELECT 1 FROM crm.consents WHERE lead_id = $1 AND purpose = 'marketing_measurement'", [r.leadId])).length, 0)
      const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [r.submissionId])
      assert.deepEqual(sub.answers.marketing, choice)
      assert.equal((await readMarketingConsentState(pool, r.leadId)).granted, false)
    }
  })

  async function confirmFor(session: BookingSession, leadEmail: string, extra: { metaHomologation?: boolean; failGoogle?: boolean } = {}) {
    // Regras ATUAIS (disponibilidade V2) com janela ampliada só no teste, como em booking-no-invite.db.test.ts.
    const slot = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], TEST_RULES)).find(x => x.length)![0]
    return confirmBookingRequest({
      pool, verifySession: () => session, getForm: getBookingForm,
      readBusy: async () => [], createEvent: async i => {
        if (extra.failGoogle) throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
        return { id: 'evt' + i.requestId.replaceAll('-', ''), meetingUrl: null, htmlLink: null }
      },
      calendarId: 'cal-' + randomUUID(), allowedEmail: leadEmail, loadRules: async () => TEST_RULES,
      metaHomologation: extra.metaHomologation,
    }, { bookingToken: 'x', startAt: slot.startAt, pageOrigin: ORIGIN })
  }

  it('agendamento SEM marketing funciona; Schedule só para lead REAL (nunca teste)', async () => {
    const realEmail = email('agenda.semmkt')
    const real = await confirmFor(await sessionFor(realEmail, REFUSE), realEmail)
    assert.equal(real.status, 201)
    const tracking = real.body.tracking as { schedule: { eventName: string; eventId: string } }
    assert.equal(tracking.schedule.eventName, 'Schedule')
    const testEmail = email('agenda.teste')
    const test = await confirmFor(await sessionFor(testEmail, GRANT, true), testEmail)
    assert.equal(test.status, 201)
    assert.equal('tracking' in test.body, false, 'reunião de teste nunca vira conversão')
  })

  it('homologação: Schedule de TESTE só com a liberação, após a reunião confirmada; falha no Google = nada', async () => {
    const a = email('homolog.ok')
    const ok = await confirmFor(await sessionFor(a, GRANT, true), a, { metaHomologation: true })
    assert.equal(ok.status, 201)
    const schedule = (ok.body.tracking as { schedule: { eventName: string; eventId: string; homologation?: boolean } }).schedule
    assert.equal(schedule.eventName, 'Schedule')
    assert.equal(schedule.homologation, true)
    assert.match(schedule.eventId, /^chronos_scheduled_[0-9a-f]{32}$/)
    const b = email('homolog.sem')
    const again = await confirmFor(await sessionFor(b, GRANT, true), b)
    assert.equal('tracking' in again.body, false, 'sem liberação: teste nunca vira conversão')
    const f = email('homolog.falha')
    const failed = await confirmFor(await sessionFor(f, GRANT, true), f, { metaHomologation: true, failGoogle: true })
    assert.notEqual(failed.status, 201)
    assert.equal('tracking' in failed.body, false, 'sem evento no Google, sem Schedule')
  })

  it('REVOGAÇÃO pela página aberta: auditável, sem tocar no cadastro, e bloqueia a futura CAPI', async () => {
    const address = email('revoga')
    const session = await sessionFor(address, GRANT)
    const booked = await confirmFor(session, address)
    assert.equal(booked.status, 201)
    const before = await leadSnapshot(session.leadId)
    const meetingsBefore = await q('SELECT id, status FROM crm.appointments WHERE lead_id = $1', [session.leadId])

    assert.deepEqual(await visitorChange(session, false), { status: 200, body: { ok: true } })
    const state = await readMarketingConsentState(pool, session.leadId)
    assert.equal(state.granted, false)
    const rows = await q<{ granted: boolean; revoked: boolean }>(
      `SELECT granted, revoked_at IS NOT NULL AS revoked FROM crm.consents
        WHERE lead_id = $1 AND purpose = 'marketing_measurement' ORDER BY recorded_at`, [session.leadId])
    assert.deepEqual(rows, [{ granted: true, revoked: true }, { granted: false, revoked: false }], 'histórico preservado')
    const [activity] = await q<{ performed_by: string; details: Record<string, unknown> }>(
      "SELECT performed_by, details FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'marketing_consent_revoked'", [session.leadId])
    assert.deepEqual(activity, { performed_by: 'visitor',
      details: { source: 'visitor_preferences', policyVersion: MARKETING_POLICY_VERSION, clickIdsRemoved: 0 } })
    assert.deepEqual(await leadSnapshot(session.leadId), before, 'cadastro do lead não muda')
    assert.deepEqual(await q('SELECT id, status FROM crm.appointments WHERE lead_id = $1', [session.leadId]), meetingsBefore)

    // Future CAPI reads the CURRENT state at send time: revoked = nothing is sent.
    const events = await q<{ event_id: string; event_name: string; occurred_at: Date; event_source_url: string | null; metadata: unknown }>(
      `SELECT event_id, event_name, occurred_at, event_source_url, metadata FROM crm.tracking_events
        WHERE lead_id = $1 AND event_name IN ('Lead', 'Chronos_Scheduled')`, [session.leadId])
    assert.equal(events.length, 2)
    for (const row of events) assert.deepEqual(buildMetaServerEvent(row, state), { allowed: false, reason: 'no_marketing_consent' })

    // Repeating the same choice does not create noise.
    assert.equal((await visitorChange(session, false)).status, 200)
    assert.equal((await q("SELECT 1 FROM crm.consents WHERE lead_id = $1 AND purpose = 'marketing_measurement'", [session.leadId])).length, 2)

    // The visitor may authorize again in the notice: new record, CAPI allowed again (same event_id).
    assert.equal((await visitorChange(session, true)).status, 200)
    const regranted = await readMarketingConsentState(pool, session.leadId)
    assert.equal(regranted.granted, true)
    const built = events.map(row => buildMetaServerEvent(row, regranted))
    assert.deepEqual(built.map(b => b.allowed && b.payload.event_id).sort(), events.map(e => e.event_id).sort())
  })

  it('REVOGAÇÃO por pedido ao canal de privacidade (administrador): só revoga, com auditoria', async () => {
    const session = await sessionFor(email('canal'), GRANT)
    assert.deepEqual(await changeMarketingConsent(pool, {
      leadId: session.leadId, granted: true, source: 'privacy_request', adminSessionRef: 'abc123',
    }), { outcome: 'not_allowed' }, 'administrador não pode autorizar em nome do titular')
    const r = await changeMarketingConsent(pool, { leadId: session.leadId, granted: false, source: 'privacy_request', adminSessionRef: 'abc123' })
    assert.equal(r.outcome, 'changed')
    const [activity] = await q<{ performed_by: string; details: Record<string, unknown> }>(
      "SELECT performed_by, details FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'marketing_consent_revoked'", [session.leadId])
    assert.deepEqual(activity, { performed_by: 'crm_admin',
      details: { source: 'privacy_request', policyVersion: MARKETING_POLICY_VERSION, clickIdsRemoved: 0, sessionRef: 'abc123' } })
    assert.deepEqual(await changeMarketingConsent(pool, { leadId: randomUUID(), granted: false, source: 'privacy_request' }),
      { outcome: 'not_found' })
  })

  it('novo envio com RECUSA explícita revoga autorização anterior; envio sem escolha não muda nada', async () => {
    const address = email('reenvio.recusa')
    const first = await submit(address, { marketing: GRANT })
    await submit(address, { marketing: NO_CHOICE })
    assert.equal((await readMarketingConsentState(pool, first.leadId)).granted, true, 'sem escolha não revoga')
    await submit(address, { marketing: REFUSE })
    assert.equal((await readMarketingConsentState(pool, first.leadId)).granted, false)
    const [activity] = await q<{ details: Record<string, unknown> }>(
      "SELECT details FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'marketing_consent_revoked'", [first.leadId])
    assert.equal(activity.details.source, 'form_submission')
  })

  it('sessão inválida não grava nada; nada foi enfileirado para a Meta', async () => {
    const r = await handleMarketingConsentChange({ pool, verifySession: () => null }, { bookingToken: 'x', marketing: false })
    assert.equal(r.status, 401)
    assert.equal((await q('SELECT 1 FROM crm.meta_deliveries')).length, 0)
    assert.equal((await q("SELECT 1 FROM crm.form_submissions WHERE answers::text LIKE '%fb.1.%'")).length, 0)
  })

  // ── Decisão G2 — fbclid só com consentimento validado no servidor ──────────────────────────
  const ACCEPTED = 'cassiellos_consent=' + serializeConsent({ analytics: null, marketing: true })
  const REFUSED = 'cassiellos_consent=' + serializeConsent({ analytics: null, marketing: false })
  const CLICK = 'IwAR0g2ClickId_' + randomUUID().slice(0, 8)
  async function intake(address: string, opts: { marketing?: Record<string, unknown>; cookie?: string | null; isTest?: boolean } = {}) {
    const r = await handleLeadIntake(intakeDeps({ isTest: opts.isTest }), { remoteIp: null, cookieHeader: opts.cookie ?? null, value: {
      formSlug: 'odontologia', idempotencyKey: randomUUID(), name: 'Lead G2', email: address, whatsapp: '(31) 90000-0072',
      answers: { clinic: 'Clínica G2', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: { utm_source: 'meta', utm_campaign: 'g2', fbclid: CLICK },
      privacyAccepted: true, turnstileToken: K.dummyToken, marketing: opts.marketing ?? {},
    } })
    assert.equal(r.status, 201)
    const [lead] = await q<{ id: string }>('SELECT id FROM crm.leads WHERE email = $1', [address])
    return { response: r, leadId: lead.id }
  }
  const attributions = async (leadId: string) => (await q<{ a: Record<string, string> }>(
    "SELECT answers->'attribution' AS a FROM crm.form_submissions WHERE lead_id = $1 ORDER BY submitted_at, id", [leadId])).map(r => r.a)

  it('G2-1/7 cadastro REAL com consentimento e fbclid: fbclid guardado, Lead para o navegador', async () => {
    const { response, leadId } = await intake(email('g2.aceite'), { marketing: GRANT, cookie: ACCEPTED })
    assert.deepEqual(await attributions(leadId), [{ utm_source: 'meta', utm_campaign: 'g2', fbclid: CLICK }])
    assert.deepEqual(response.body.tracking, { lead: { eventName: 'Lead', eventId: leadTrackingEventId(leadId) } })
  })

  it('G2-2 sem consentimento e com fbclid na URL: fbclid descartado, utm_* preservados', async () => {
    for (const cookie of [null, ACCEPTED]) { // a lone cookie without the body choice is not consent
      const { leadId } = await intake(email('g2.semconsent'), { marketing: {}, cookie })
      assert.deepEqual(await attributions(leadId), [{ utm_source: 'meta', utm_campaign: 'g2' }])
    }
    const forged = await intake(email('g2.forjado'), { marketing: GRANT, cookie: null })
    assert.deepEqual(await attributions(forged.leadId), [{ utm_source: 'meta', utm_campaign: 'g2' }], 'aceite sem cookie não vale')
  })

  it('G2-3 recusa de cookies: fbclid descartado e nenhum consentimento de marketing', async () => {
    const { leadId } = await intake(email('g2.recusa'), { marketing: REFUSE, cookie: REFUSED })
    assert.deepEqual(await attributions(leadId), [{ utm_source: 'meta', utm_campaign: 'g2' }])
    assert.equal((await readMarketingConsentState(pool, leadId)).granted, false)
  })

  it('G2-4/9 revogação apaga o fbclid de TODOS os envios, preserva o resto e audita só a quantidade', async () => {
    const address = email('g2.revoga')
    const first = await intake(address, { marketing: GRANT, cookie: ACCEPTED })
    await intake(address, { marketing: GRANT, cookie: ACCEPTED })
    // Legacy row stored before G2 (fbclid without consent), written directly at the storage level.
    await q(`UPDATE crm.form_submissions SET answers = jsonb_set(answers, '{attribution,fbclid}', to_jsonb($2::text))
              WHERE id = (SELECT id FROM crm.form_submissions WHERE lead_id = $1 ORDER BY submitted_at DESC, id DESC LIMIT 1)`,
      [first.leadId, CLICK])
    const leadBefore = await leadSnapshot(first.leadId)
    const counts = async () => (await q<{ s: string; c: string; a: string }>(
      `SELECT (SELECT count(*) FROM crm.form_submissions WHERE lead_id = $1) AS s,
              (SELECT count(*) FROM crm.consents WHERE lead_id = $1) AS c,
              (SELECT count(*) FROM crm.lead_activities WHERE lead_id = $1) AS a`, [first.leadId]))[0]
    const before = await counts()
    const session = { leadId: first.leadId, submissionId: 'x', formSlug: 'odontologia' }
    assert.equal((await visitorChange(session, false)).status, 200)
    assert.deepEqual(await attributions(first.leadId), [
      { utm_source: 'meta', utm_campaign: 'g2' }, { utm_source: 'meta', utm_campaign: 'g2' }])
    const [answers] = await q<{ q: Record<string, string> }>(
      "SELECT answers->'questions' AS q FROM crm.form_submissions WHERE lead_id = $1 LIMIT 1", [first.leadId])
    assert.equal(answers.q.clinic, 'Clínica G2', 'respostas do formulário preservadas')
    assert.deepEqual(await leadSnapshot(first.leadId), leadBefore, 'cadastro do lead não muda')
    const after = await counts()
    assert.equal(after.s, before.s, 'nenhum envio apagado')
    assert.equal(Number(after.c), Number(before.c) + 1, 'histórico de consentimento só cresce')
    assert.equal(Number(after.a), Number(before.a) + 1, 'uma atividade de auditoria')
    const [activity] = await q<{ details: Record<string, unknown> }>(
      "SELECT details FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'marketing_consent_revoked'", [first.leadId])
    assert.deepEqual(activity.details, { source: 'visitor_preferences', policyVersion: MARKETING_POLICY_VERSION, clickIdsRemoved: 2 })
    const everything = JSON.stringify(await q(
      `SELECT (SELECT json_agg(s.answers) FROM crm.form_submissions s WHERE s.lead_id = $1) AS s,
              (SELECT json_agg(a) FROM crm.lead_activities a WHERE a.lead_id = $1) AS a,
              (SELECT json_agg(t) FROM crm.tracking_events t WHERE t.lead_id = $1) AS t`, [first.leadId]))
    assert.equal(everything.includes(CLICK), false, 'o valor do fbclid não sobra em lugar nenhum')
  })

  it('G2 pedido ao canal sem autorização ativa: apaga fbclid antigo mesmo assim, com auditoria', async () => {
    const { leadId } = await intake(email('g2.legado'), { marketing: {}, cookie: null })
    await q(`UPDATE crm.form_submissions SET answers = jsonb_set(answers, '{attribution,fbclid}', to_jsonb($2::text)) WHERE lead_id = $1`, [leadId, CLICK])
    const r = await changeMarketingConsent(pool, { leadId, granted: false, source: 'privacy_request', adminSessionRef: 'ref9' })
    assert.deepEqual(r.outcome === 'unchanged' && r.clickIdsRemoved, 1)
    assert.deepEqual(await attributions(leadId), [{ utm_source: 'meta', utm_campaign: 'g2' }])
    const [activity] = await q<{ performed_by: string; details: Record<string, unknown> }>(
      "SELECT performed_by, details FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'marketing_identifiers_removed'", [leadId])
    assert.deepEqual(activity, { performed_by: 'crm_admin', details: { source: 'privacy_request', clickIdsRemoved: 1, sessionRef: 'ref9' } })
  })

  it('G2-5 reenvio: sem escolha não guarda fbclid novo nem apaga o anterior; recusa explícita apaga tudo', async () => {
    const address = email('g2.reenvio')
    const { leadId } = await intake(address, { marketing: GRANT, cookie: ACCEPTED })
    await intake(address, { marketing: {}, cookie: null })
    assert.deepEqual(await attributions(leadId), [
      { utm_source: 'meta', utm_campaign: 'g2', fbclid: CLICK }, { utm_source: 'meta', utm_campaign: 'g2' }])
    assert.equal((await readMarketingConsentState(pool, leadId)).granted, true)
    await intake(address, { marketing: REFUSE, cookie: REFUSED })
    assert.deepEqual((await attributions(leadId)).map(a => 'fbclid' in a), [false, false, false])
    assert.equal((await readMarketingConsentState(pool, leadId)).granted, false)
    assert.equal((await q("SELECT 1 FROM crm.tracking_events WHERE lead_id = $1 AND event_name = 'Lead'", [leadId])).length, 1)
  })

  it('G2-6 lead de TESTE: mesma regra do fbclid e nenhuma conversão', async () => {
    const accepted = await intake(email('g2.teste.aceite'), { marketing: GRANT, cookie: ACCEPTED, isTest: true })
    assert.equal('fbclid' in (await attributions(accepted.leadId))[0], true)
    assert.equal('tracking' in accepted.response.body, false, 'lead de teste nunca recebe Lead')
    const refused = await intake(email('g2.teste.recusa'), { marketing: REFUSE, cookie: REFUSED, isTest: true })
    assert.equal('fbclid' in (await attributions(refused.leadId))[0], false)
  })

  it('G2-8 agendamento depois de recusar marketing funciona normalmente', async () => {
    const address = email('g2.agenda')
    const { leadId } = await intake(address, { marketing: REFUSE, cookie: REFUSED })
    const [sub] = await q<{ id: string }>('SELECT id FROM crm.form_submissions WHERE lead_id = $1', [leadId])
    const booked = await confirmFor({ leadId, submissionId: sub.id, formSlug: 'odontologia' }, address)
    assert.equal(booked.status, 201)
    assert.equal((await q("SELECT 1 FROM crm.appointments WHERE lead_id = $1 AND status = 'confirmed'", [leadId])).length, 1)
  })
})
