/**
 * Homologação isolada do /agendar — fluxo completo contra PostgreSQL DESCARTÁVEL (CRM_INTEGRATION_DATABASE_URL):
 * formulário → Turnstile (chaves oficiais de teste, Siteverify simulado com a resposta documentada pela Cloudflare)
 * → cadastro no banco → sessão → confirmação na agenda SIMULADA. Nenhuma rede (o fetch global lança erro),
 * nenhum Google, nenhum e-mail, nenhuma integração real. Endereços fictícios.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { bookingAccessConfig } from './booking-access'
import { confirmBookingRequest, type BookingSession } from './booking-confirmation'
import { getBookingForm } from './booking-forms'
import { handleLeadIntake, type IntakeDeps } from './booking-intake-request'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from './availability/engine'
import { homologMode } from './homolog-mode'
import { simulatedBusyIntervals, simulatedCreateEvent } from './homolog-calendar'
import { saveLeadSubmission } from './lead-intake'
import { TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS as K, getTurnstileConfig, verifyTurnstileToken, type FetchLike } from './turnstile'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const BRANCH_HOST = 'agencia-cassiellos-git-crm-homolog-cassiellos-projects.vercel.app'
const ORIGIN = 'https://' + BRANCH_HOST
const ENV = {
  VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'crm-homolog', VERCEL_BRANCH_URL: BRANCH_HOST,
  CRM_HOMOLOG_MODE: 'true', CRM_HOMOLOG_DATABASE_URL: 'postgresql://h:h@ep-homolog-ficticio.example.com/homolog_db',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: K.siteAlwaysPasses, TURNSTILE_SECRET_KEY: K.secretAlwaysPasses,
}
const RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }
const SLOTS = (() => {
  const out: { startAt: string; endAt: string }[] = []
  for (let d = 3; d < 30; d++) {
    const day = listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], RULES)
    for (const i of [2, 4]) if (day[i]) out.push(day[i])
  }
  return out
})()

describe('/agendar em homologação isolada (PostgreSQL descartável, sem integrações reais)', { skip }, () => {
  let pool: Pool
  let realFetch: typeof fetch
  before(() => {
    pool = new Pool({ connectionString: url, max: 4 })
    realFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('rede proibida na homologação isolada') }) as typeof fetch
  })
  after(async () => { globalThis.fetch = realFetch; await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows

  /** Siteverify de teste: a resposta DOCUMENTADA pela Cloudflare para as chaves de teste (hostname/action de teste). */
  const siteverify: FetchLike = async (_u, init) => {
    const b = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => (b.secret === K.secretAlwaysPasses && b.response === K.dummyToken
      ? { success: true, challenge_ts: new Date().toISOString(), hostname: 'localhost', action: 'test', cdata: 'test-data' }
      : { success: false, 'error-codes': ['invalid-input-response'] }) }
  }
  function intakeDeps(): IntakeDeps {
    const state = homologMode(ENV)
    assert.equal(state.active, true)
    const hostnames = state.active ? [...state.hostnames, 'localhost', '127.0.0.1', 'example.com'] : []
    return {
      getForm: getBookingForm,
      turnstileConfig: getTurnstileConfig(ENV),
      expectedHostnames: hostnames,
      verifyTurnstile: ({ token, secretKey, remoteIp }) => verifyTurnstileToken({ token, secretKey, remoteIp,
        expectedAction: TURNSTILE_BOOKING_ACTION, acceptedActionAliases: ['test'], expectedHostnames: hostnames, fetchImpl: siteverify }),
      consumeIpQuota: async () => true,
      saveLead: input => saveLeadSubmission(pool, input),
      createGrant: data => JSON.stringify(data),
      classifyNewLeadAsTest: () => true,
      bookingMode: 'test',
      publicOrigin: ORIGIN,
      log: () => undefined,
    }
  }
  const form = (address: string, token: string) => ({
    formSlug: 'odontologia', idempotencyKey: randomUUID(), name: 'Lead Homologação', email: address, whatsapp: '31900000099',
    answers: { instagram: '@homologacao', revenue: 'Até R$ 10 mil/mês', budget: 'Sim' },
    attribution: {}, privacyAccepted: true, contactRequest: true, turnstileToken: token,
  })
  const confirm = (token: unknown, startAt: string) => confirmBookingRequest({
    pool, verifySession: t => JSON.parse(String(t)) as BookingSession, getForm: getBookingForm,
    readBusy: simulatedBusyIntervals, createEvent: simulatedCreateEvent, calendarId: 'agenda-homologacao',
    ...(({ allowedEmail, restrictedToAllowedEmail, sendInvites }) => ({ allowedEmail, restrictToAllowedEmail: restrictedToAllowedEmail, sendInvites }))(bookingAccessConfig(ENV)),
    loadRules: async () => RULES,
  }, { bookingToken: token, startAt, pageOrigin: ORIGIN })

  it('token de teste válido cadastra o lead (de teste), sem gravar o token; token forjado não grava nada', async () => {
    const address = 'homolog.' + randomUUID().slice(0, 8) + '@exemplo.com'
    const bad = await handleLeadIntake(intakeDeps(), { value: form(address, 'token-forjado'), remoteIp: null })
    assert.equal(bad.status, 403)
    assert.equal((await q('SELECT 1 FROM crm.leads WHERE email = $1', [address])).length, 0)

    const good = await handleLeadIntake(intakeDeps(), { value: form(address, K.dummyToken), remoteIp: null })
    assert.equal(good.status, 201, JSON.stringify(good.body))
    const [lead] = await q<{ is_test: boolean }>('SELECT is_test FROM crm.leads WHERE email = $1', [address])
    assert.equal(lead.is_test, true)
    const [sub] = await q<{ answers: Record<string, any> }>('SELECT answers FROM crm.form_submissions WHERE id = $1', [good.body.submissionId])
    assert.equal(sub.answers.protection.turnstile, 'verified')
    assert.equal(sub.answers.protection.action, TURNSTILE_BOOKING_ACTION)
    assert.equal(JSON.stringify(sub.answers).includes(K.dummyToken), false, 'o token não é armazenado')
  })

  it('cadastro → confirmação na agenda simulada: reunião criada no banco, sem convite e sem nenhuma chamada de rede', async () => {
    const address = 'homolog.' + randomUUID().slice(0, 8) + '@exemplo.com'
    const good = await handleLeadIntake(intakeDeps(), { value: form(address, K.dummyToken), remoteIp: null })
    assert.equal(good.status, 201, JSON.stringify(good.body))
    const result = await confirm(good.body.bookingToken, SLOTS[0].startAt)
    assert.equal(result.status, 201, JSON.stringify(result.body))
    const rows = JSON.stringify(await q('SELECT * FROM crm.booking_requests WHERE lead_id = $1', [good.body.leadId]))
    assert.match(rows, /homolog[0-9a-f]{32}/, 'identificador local da agenda simulada')
    assert.equal((await q('SELECT 1 FROM crm.appointments WHERE lead_id = $1', [good.body.leadId])).length, 1)
  })

  it('fora do modo (sem CRM_HOMOLOG_MODE) o mesmo ambiente NÃO libera chaves de teste', () => {
    assert.deepEqual(getTurnstileConfig({ ...ENV, CRM_HOMOLOG_MODE: undefined }), { status: 'test_keys_in_deployment' })
    assert.deepEqual(getTurnstileConfig({ ...ENV, VERCEL_ENV: 'production' }), { status: 'test_keys_in_deployment' })
  })
})
