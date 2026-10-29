import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { getBookingForm } from './booking-forms'
import { handleLeadIntake, type IntakeDeps } from './booking-intake-request'
import type { LeadSubmissionInput } from './lead-intake'
import {
  TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS as K, verifyTurnstileToken, type FetchLike, type TurnstileConfig,
} from './turnstile'

const HOST = 'crm.cassiellos.com.br'

/** Siteverify simulado com as chaves oficiais de teste (1x passa, 2x falha, 3x já usado). */
function siteverify(override: Record<string, unknown> = {}): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(init.body)
    const data = body.secret === K.secretAlwaysPasses && body.response === K.dummyToken
      ? { success: true, hostname: HOST, action: TURNSTILE_BOOKING_ACTION, challenge_ts: new Date().toISOString() }
      : body.secret === K.secretTokenSpent ? { success: false, 'error-codes': ['timeout-or-duplicate'] }
      : { success: false, 'error-codes': ['invalid-input-response'] }
    return { ok: true, status: 200, json: async () => ({ ...data, ...override }) }
  }
}

function setup(opts: {
  config?: TurnstileConfig
  fetchImpl?: FetchLike
  quota?: boolean
} = {}) {
  const saved: LeadSubmissionInput[] = []
  const events: string[] = []
  let quotaCalls = 0
  let verifyCalls = 0
  const config: TurnstileConfig = opts.config ??
    { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretAlwaysPasses, usingTestKeys: true }
  const deps: IntakeDeps = {
    getForm: getBookingForm,
    turnstileConfig: config,
    expectedHostnames: [HOST],
    verifyTurnstile: ({ token, secretKey, remoteIp }) => {
      verifyCalls++
      return verifyTurnstileToken({ token, secretKey, remoteIp, expectedAction: TURNSTILE_BOOKING_ACTION,
        expectedHostnames: [HOST], fetchImpl: opts.fetchImpl ?? siteverify() })
    },
    consumeIpQuota: async () => { quotaCalls++; return opts.quota ?? true },
    saveLead: async input => {
      saved.push(input)
      return { leadId: randomUUID(), submissionId: randomUUID(), reused: false, resubmitted: false }
    },
    createGrant: data => 'grant:' + data.submissionId,
    classifyNewLeadAsTest: () => true,
    bookingMode: 'test',
    log: (event, details) => events.push(event + ':' + (details.reason ?? '') + ':' + (details.codes ?? []).join(',')),
  }
  return { deps, saved, events, counts: () => ({ quotaCalls, verifyCalls }) }
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formSlug: 'odontologia', idempotencyKey: randomUUID(),
    name: 'Lead Turnstile', email: 'lead.turnstile@exemplo.com', whatsapp: '(31) 90000-0001',
    answers: { clinic: 'Clínica Teste', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
    attribution: { utm_source: 'teste' }, privacyAccepted: true, turnstileToken: K.dummyToken, ...over,
  }
}

describe('handleLeadIntake — Turnstile obrigatório antes de qualquer gravação', () => {
  it('token válido: grava lead com a verificação registrada e emite sessão', async () => {
    const t = setup()
    const r = await handleLeadIntake(t.deps, { value: body(), remoteIp: '203.0.113.9' })
    assert.equal(r.status, 201)
    assert.equal(r.body.ok, true)
    assert.match(String(r.body.bookingToken), /^grant:/)
    assert.equal(t.saved.length, 1)
    assert.deepEqual({ ...t.saved[0].protection, challengeTs: null },
      { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: HOST, challengeTs: null })
    assert.equal(t.saved[0].email, 'lead.turnstile@exemplo.com')
    assert.deepEqual(t.counts(), { quotaCalls: 1, verifyCalls: 1 })
  })

  const rejected: [string, Record<string, unknown>, Parameters<typeof setup>[0], number, string][] = [
    ['token ausente', { turnstileToken: undefined }, {}, 400, 'SECURITY_CHECK_REQUIRED'],
    ['token vazio', { turnstileToken: '' }, {}, 400, 'SECURITY_CHECK_REQUIRED'],
    ['token inválido', { turnstileToken: 'token-forjado' }, {}, 403, 'SECURITY_CHECK_FAILED'],
    ['token expirado', {}, { fetchImpl: siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }) }, 403, 'SECURITY_CHECK_EXPIRED'],
    ['token reutilizado (chave 3x)', {}, { config: { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretTokenSpent, usingTestKeys: true } }, 403, 'SECURITY_CHECK_EXPIRED'],
    ['hostname incorreto', {}, { fetchImpl: siteverify({ hostname: 'outro-site.com' }) }, 403, 'SECURITY_CHECK_FAILED'],
    ['action incorreta', {}, { fetchImpl: siteverify({ action: 'login' }) }, 403, 'SECURITY_CHECK_FAILED'],
    ['Siteverify indisponível', {}, { fetchImpl: async () => { throw new Error('down') } }, 503, 'SECURITY_CHECK_UNAVAILABLE'],
    ['chaves ausentes', {}, { config: { status: 'missing' } }, 503, 'SECURITY_CHECK_UNAVAILABLE'],
    ['chaves de teste em deploy', {}, { config: { status: 'test_keys_in_deployment' } }, 503, 'SECURITY_CHECK_UNAVAILABLE'],
  ]
  for (const [title, override, options, status, error] of rejected) {
    it(title + ': ' + error + ', sem gravação e sem consumir limite por IP', async () => {
      const t = setup(options)
      const r = await handleLeadIntake(t.deps, { value: body(override), remoteIp: null })
      assert.deepEqual(r, { status, body: { error } })
      assert.equal(t.saved.length, 0)
      assert.equal(t.counts().quotaCalls, 0)
    })
  }

  it('limite por IP atingido: 429 mesmo com token válido, sem gravação', async () => {
    const t = setup({ quota: false })
    const r = await handleLeadIntake(t.deps, { value: body(), remoteIp: null })
    assert.deepEqual(r, { status: 429, body: { error: 'TOO_MANY_REQUESTS' } })
    assert.equal(t.saved.length, 0)
  })

  it('validações baratas acontecem antes (sem chamada à Cloudflare)', async () => {
    for (const [override, error] of [
      [{ website: 'http://spam' }, 'INVALID_REQUEST'], [{ formSlug: 'x' }, 'UNKNOWN_FORM'],
      [{ idempotencyKey: '1' }, 'INVALID_REQUEST_KEY'], [{ email: 'nao-e-email' }, 'INVALID_EMAIL'],
      [{ privacyAccepted: false }, 'PRIVACY_NOT_ACCEPTED'],
    ] as const) {
      const t = setup()
      const r = await handleLeadIntake(t.deps, { value: body(override), remoteIp: null })
      assert.equal(r.body.error, error)
      assert.deepEqual(t.counts(), { quotaCalls: 0, verifyCalls: 0 })
    }
  })

  it('e-mail é normalizado (espaços e maiúsculas) antes de gravar', async () => {
    const t = setup()
    await handleLeadIntake(t.deps, { value: body({ email: '  Lead.Turnstile@Exemplo.COM ' }), remoteIp: null })
    assert.equal(t.saved[0].email, 'lead.turnstile@exemplo.com')
  })

  it('logs só com motivo e códigos — nunca token, e-mail, IP ou segredo', async () => {
    const t = setup({ fetchImpl: siteverify({ hostname: 'outro.com' }) })
    await handleLeadIntake(t.deps, { value: body(), remoteIp: '203.0.113.9' })
    const t2 = setup()
    await handleLeadIntake(t2.deps, { value: body({ turnstileToken: 'token-forjado' }), remoteIp: '203.0.113.9' })
    const logs = [...t.events, ...t2.events].join('\n')
    assert.match(logs, /security_check_rejected:hostname_mismatch/)
    assert.match(logs, /security_check_rejected:invalid:invalid-input-response/)
    for (const secret of [K.dummyToken, 'token-forjado', 'lead.turnstile', '203.0.113.9', K.secretAlwaysPasses]) {
      assert.equal(logs.includes(secret), false, secret)
    }
  })

  it('respostas públicas não revelam se o lead já existia', async () => {
    const t = setup()
    t.deps.saveLead = async () => ({ leadId: randomUUID(), submissionId: randomUUID(), reused: false, resubmitted: true })
    const r = await handleLeadIntake(t.deps, { value: body(), remoteIp: null })
    assert.equal(r.status, 201)
    assert.equal('resubmitted' in r.body, false)
  })
})
