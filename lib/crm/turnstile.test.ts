/**
 * Turnstile — testes automatizados com as chaves OFICIAIS de teste da Cloudflare.
 * O Siteverify é simulado com as respostas documentadas para essas chaves
 * (1x… sempre passa, 2x… sempre falha, 3x… "timeout-or-duplicate"), sem rede.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  TURNSTILE_BOOKING_ACTION, TURNSTILE_SITEVERIFY_URL, TURNSTILE_TEST_KEYS as K,
  bookingActionPolicy, getTurnstileConfig, isTurnstileTestKey, publicTurnstileError, verifyTurnstileToken,
  type FetchLike, type TurnstileConfig, type VerifyTurnstileInput,
} from './turnstile'

const HOST = 'crm.cassiellos.com.br'
const NOW = new Date('2026-10-29T18:00:00.000Z')

type Call = { url: string; body: Record<string, string> }

/** Siteverify simulado conforme a documentação das chaves de teste. */
function cloudflare(overrides: Record<string, unknown> = {}, calls: Call[] = []): FetchLike {
  // A token is accepted once; repeating the SAME idempotency_key returns the original result.
  const spent = new Map<string, string>()
  return async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, string>
    calls.push({ url, body })
    let data: Record<string, unknown>
    if (body.secret === K.secretAlwaysFails) data = { success: false, 'error-codes': ['invalid-input-response'] }
    else if (body.secret === K.secretTokenSpent) data = { success: false, 'error-codes': ['timeout-or-duplicate'] }
    else if (body.secret !== K.secretAlwaysPasses) data = { success: false, 'error-codes': ['invalid-input-secret'] }
    else if (body.response !== K.dummyToken) data = { success: false, 'error-codes': ['invalid-input-response'] }
    else if (spent.has(body.response) && spent.get(body.response) !== body.idempotency_key) {
      data = { success: false, 'error-codes': ['timeout-or-duplicate'] }
    }
    else {
      data = { success: true, challenge_ts: '2026-10-29T17:59:00.000Z', hostname: HOST,
        'error-codes': [], action: TURNSTILE_BOOKING_ACTION, cdata: '' }
    }
    if (data.success) spent.set(body.response, body.idempotency_key)
    return { ok: true, status: 200, json: async () => ({ ...data, ...overrides }) }
  }
}

let sequence = 0
function input(over: Partial<VerifyTurnstileInput> = {}): VerifyTurnstileInput {
  const n = ++sequence
  return {
    token: K.dummyToken, secretKey: K.secretAlwaysPasses, expectedAction: TURNSTILE_BOOKING_ACTION,
    expectedHostnames: [HOST], remoteIp: '203.0.113.7', now: NOW, fetchImpl: cloudflare(),
    idempotencyKey: () => 'key-' + n, ...over,
  }
}

describe('verifyTurnstileToken — Siteverify no servidor', () => {
  it('token válido: success, hostname e action conferidos', async () => {
    const calls: Call[] = []
    const r = await verifyTurnstileToken(input({ fetchImpl: cloudflare({}, calls) }))
    assert.deepEqual(r, { ok: true, hostname: HOST, action: TURNSTILE_BOOKING_ACTION, challengeTs: '2026-10-29T17:59:00.000Z' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, TURNSTILE_SITEVERIFY_URL)
    assert.equal(calls[0].body.secret, K.secretAlwaysPasses, 'segredo só no corpo da chamada servidor→Cloudflare')
    assert.equal(calls[0].body.remoteip, '203.0.113.7')
  })

  it('token ausente: rejeitado sem chamar a Cloudflare', async () => {
    for (const token of [undefined, null, '', '   ', 123]) {
      const calls: Call[] = []
      const r = await verifyTurnstileToken(input({ token, fetchImpl: cloudflare({}, calls) }))
      assert.deepEqual(r, { ok: false, reason: 'missing', codes: [] })
      assert.equal(calls.length, 0)
    }
  })

  it('token inválido / malformado / recusado (chave 2x)', async () => {
    assert.equal((await verifyTurnstileToken(input({ token: 'x'.repeat(2049) }))).ok, false)
    assert.deepEqual(await verifyTurnstileToken(input({ token: 'abc def' })), { ok: false, reason: 'invalid', codes: ['malformed-token'] })
    assert.deepEqual(await verifyTurnstileToken(input({ token: 'token-forjado' })),
      { ok: false, reason: 'invalid', codes: ['invalid-input-response'] })
    assert.deepEqual(await verifyTurnstileToken(input({ secretKey: K.secretAlwaysFails })),
      { ok: false, reason: 'invalid', codes: ['invalid-input-response'] })
  })

  it('token reutilizado (chave 3x e segunda validação do mesmo token)', async () => {
    assert.deepEqual(await verifyTurnstileToken(input({ secretKey: K.secretTokenSpent })),
      { ok: false, reason: 'expired_or_reused', codes: ['timeout-or-duplicate'] })
    // A token is accepted once: replaying it in a NEW request (new idempotency_key) fails.
    const fetchImpl = cloudflare()
    assert.equal((await verifyTurnstileToken(input({ fetchImpl }))).ok, true)
    assert.deepEqual(await verifyTurnstileToken(input({ fetchImpl })),
      { ok: false, reason: 'expired_or_reused', codes: ['timeout-or-duplicate'] })
    // The default generator creates a fresh idempotency_key for every verification.
    const keys = new Set<string>()
    const spy: FetchLike = async (u, init) => { keys.add(JSON.parse(init.body).idempotency_key); return cloudflare()(u, init) }
    await verifyTurnstileToken({ ...input({ fetchImpl: spy }), idempotencyKey: undefined })
    await verifyTurnstileToken({ ...input({ fetchImpl: spy }), idempotencyKey: undefined })
    assert.equal(keys.size, 2)
  })

  it('token expirado: timeout-or-duplicate ou challenge_ts com mais de 300 s', async () => {
    assert.equal((await verifyTurnstileToken(input({ fetchImpl: cloudflare({ success: false, 'error-codes': ['timeout-or-duplicate'] }) }))).ok, false)
    const old = await verifyTurnstileToken(input({ fetchImpl: cloudflare({ challenge_ts: '2026-10-29T17:54:00.000Z' }) }))
    assert.deepEqual(old, { ok: false, reason: 'expired_or_reused', codes: ['stale-challenge'] })
    const recent = await verifyTurnstileToken(input({ fetchImpl: cloudflare({ challenge_ts: '2026-10-29T17:55:01.000Z' }) }))
    assert.equal(recent.ok, true, 'dentro de 300 s (+30 s de tolerância de relógio)')
  })

  it('hostname incorreto é rejeitado', async () => {
    for (const hostname of ['evil.example.com', 'cassiellos.com.br', 'crm.cassiellos.com.br.evil.com', '', undefined]) {
      const r = await verifyTurnstileToken(input({ fetchImpl: cloudflare({ hostname }) }))
      assert.deepEqual(r, { ok: false, reason: 'hostname_mismatch', codes: [] }, String(hostname))
    }
    assert.equal((await verifyTurnstileToken(input({ fetchImpl: cloudflare({ hostname: 'CRM.Cassiellos.com.br' }) }))).ok, true)
  })

  it('action incorreta é rejeitada', async () => {
    for (const action of ['login', 'booking_lead2', '', undefined]) {
      const r = await verifyTurnstileToken(input({ fetchImpl: cloudflare({ action }) }))
      assert.deepEqual(r, { ok: false, reason: 'action_mismatch', codes: [] }, String(action))
    }
  })

  it('serviço indisponível: rede, timeout, HTTP 5xx, resposta inválida e internal-error (1 nova tentativa)', async () => {
    let attempts = 0
    const down: FetchLike = async () => { attempts++; throw new Error('ECONNRESET') }
    assert.deepEqual(await verifyTurnstileToken(input({ fetchImpl: down })), { ok: false, reason: 'unavailable', codes: ['network-error'] })
    assert.equal(attempts, 2, 'uma nova tentativa com o mesmo idempotency_key')

    const hang: FetchLike = (_url, init) => new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    assert.deepEqual(await verifyTurnstileToken(input({ fetchImpl: hang, timeoutMs: 20 })), { ok: false, reason: 'unavailable', codes: ['timeout'] })

    const http503: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) })
    assert.deepEqual(await verifyTurnstileToken(input({ fetchImpl: http503 })), { ok: false, reason: 'unavailable', codes: ['http-503'] })

    const garbage: FetchLike = async () => ({ ok: true, status: 200, json: async () => 'oops' })
    assert.equal((await verifyTurnstileToken(input({ fetchImpl: garbage }))).ok, false)

    const keys: string[] = []
    const internal: FetchLike = async (_u, init) => {
      keys.push(JSON.parse(init.body).idempotency_key)
      return { ok: true, status: 200, json: async () => ({ success: false, 'error-codes': ['internal-error'] }) }
    }
    assert.deepEqual(await verifyTurnstileToken(input({ fetchImpl: internal })), { ok: false, reason: 'unavailable', codes: ['internal-error'] })
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1], 'repetição segura usa o mesmo idempotency_key')

    let recovered = 0
    const upstream = cloudflare()
    const flaky: FetchLike = async (u, init) => {
      recovered++
      if (recovered === 1) throw new Error('blip')
      return upstream(u, init)
    }
    assert.equal((await verifyTurnstileToken(input({ fetchImpl: flaky }))).ok, true)
  })

  it('segredo recusado pela Cloudflare = configuração inválida (falha fechada)', async () => {
    assert.deepEqual(await verifyTurnstileToken(input({ secretKey: 'secret-errado-qualquer' })),
      { ok: false, reason: 'misconfigured', codes: ['invalid-input-secret'] })
  })

  it('resultado nunca contém token, segredo ou IP', async () => {
    const all = [
      await verifyTurnstileToken(input()),
      await verifyTurnstileToken(input({ token: 'token-forjado' })),
      await verifyTurnstileToken(input({ fetchImpl: cloudflare({ hostname: 'x.com' }) })),
    ]
    const text = JSON.stringify(all)
    for (const secret of [K.dummyToken, 'token-forjado', K.secretAlwaysPasses, '203.0.113.7']) {
      assert.equal(text.includes(secret), false, secret)
    }
  })

  it('códigos públicos não revelam detalhes internos', () => {
    assert.deepEqual(publicTurnstileError('missing'), { status: 400, error: 'SECURITY_CHECK_REQUIRED' })
    assert.deepEqual(publicTurnstileError('expired_or_reused'), { status: 403, error: 'SECURITY_CHECK_EXPIRED' })
    assert.deepEqual(publicTurnstileError('hostname_mismatch'), { status: 403, error: 'SECURITY_CHECK_FAILED' })
    assert.deepEqual(publicTurnstileError('action_mismatch'), { status: 403, error: 'SECURITY_CHECK_FAILED' })
    assert.deepEqual(publicTurnstileError('invalid'), { status: 403, error: 'SECURITY_CHECK_FAILED' })
    assert.deepEqual(publicTurnstileError('unavailable'), { status: 503, error: 'SECURITY_CHECK_UNAVAILABLE' })
    assert.deepEqual(publicTurnstileError('misconfigured'), { status: 503, error: 'SECURITY_CHECK_UNAVAILABLE' })
  })
})

describe('getTurnstileConfig — chaves e ambiente', () => {
  const real = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAAAAAAAAAAAAAAA', TURNSTILE_SECRET_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }

  it('sem chaves: missing (o formulário fica bloqueado)', () => {
    assert.deepEqual(getTurnstileConfig({}), { status: 'missing' })
    assert.deepEqual(getTurnstileConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: real.NEXT_PUBLIC_TURNSTILE_SITE_KEY }), { status: 'missing' })
    assert.deepEqual(getTurnstileConfig({ TURNSTILE_SECRET_KEY: real.TURNSTILE_SECRET_KEY, VERCEL_ENV: 'preview' }), { status: 'missing' })
  })

  it('chaves malformadas: invalid', () => {
    assert.deepEqual(getTurnstileConfig({ ...real, TURNSTILE_SECRET_KEY: 'abc' }), { status: 'invalid' })
    assert.deepEqual(getTurnstileConfig({ ...real, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'chave com espaço' }), { status: 'invalid' })
  })

  it('chaves reais em Preview: ready', () => {
    assert.deepEqual(getTurnstileConfig({ ...real, VERCEL: '1', VERCEL_ENV: 'preview' }),
      { status: 'ready', siteKey: real.NEXT_PUBLIC_TURNSTILE_SITE_KEY, secretKey: real.TURNSTILE_SECRET_KEY, usingTestKeys: false })
  })

  it('chaves de TESTE nunca são aceitas em deploy (Preview ou produção)', () => {
    for (const env of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }]) {
      assert.deepEqual(getTurnstileConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: K.siteAlwaysPasses,
        TURNSTILE_SECRET_KEY: K.secretAlwaysPasses, ...env }), { status: 'test_keys_in_deployment' })
      assert.deepEqual(getTurnstileConfig({ ...real, TURNSTILE_SECRET_KEY: K.secretAlwaysPasses, ...env }),
        { status: 'test_keys_in_deployment' })
    }
  })

  it('chaves de teste aceitas apenas em testes locais (sem VERCEL)', () => {
    const r = getTurnstileConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: K.siteAlwaysPasses, TURNSTILE_SECRET_KEY: K.secretAlwaysPasses })
    assert.equal(r.status, 'ready')
    assert.equal(r.status === 'ready' && r.usingTestKeys, true)
  })

  it('reconhece todas as chaves oficiais de teste', () => {
    for (const key of [K.siteAlwaysPasses, K.siteAlwaysBlocks, K.siteInvisiblePasses, K.siteInvisibleBlocks,
      K.siteForcesInteractive, K.secretAlwaysPasses, K.secretAlwaysFails, K.secretTokenSpent]) {
      assert.equal(isTurnstileTestKey(key), true, key)
    }
    assert.equal(isTurnstileTestKey('0x4AAAAAAFrhpHqMd6acN05s'), false)
  })
})

/**
 * Formato observado no Siteverify REAL com as chaves de teste (deployment de homologação): success=true, `action`
 * ausente e metadata.result_with_testing_key=true. Simulado aqui sem rede.
 */
function testingKeyResponse(o: Record<string, unknown> = {}, drop: string[] = ['action']): FetchLike {
  return async () => {
    const data: Record<string, unknown> = { success: true, challenge_ts: '2026-10-29T17:59:00.000Z', hostname: 'example.com',
      'error-codes': [], action: TURNSTILE_BOOKING_ACTION, cdata: '', metadata: { result_with_testing_key: true }, ...o }
    for (const k of drop) delete data[k]
    return { ok: true, status: 200, json: async () => data }
  }
}
const HOMOLOG_HOSTS = ['crm-homolog.example.vercel.app', 'example.com']
const TEST_READY: TurnstileConfig = { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretAlwaysPasses, usingTestKeys: true }

describe('Turnstile — homologação com chaves de teste (action do Siteverify de teste)', () => {
  const homolog = (over: Partial<VerifyTurnstileInput> = {}) => input({ expectedHostnames: HOMOLOG_HOSTS, ...bookingActionPolicy(true, TEST_READY), ...over })

  it('resposta de teste com action="test": aceita (alias preservado)', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ action: 'test' }, []) }))
    assert.deepEqual(r, { ok: true, hostname: 'example.com', action: TURNSTILE_BOOKING_ACTION, challengeTs: '2026-10-29T17:59:00.000Z' })
  })
  it('resposta de teste SEM action, com metadata.result_with_testing_key=true: aceita', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse() }))
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.action, TURNSTILE_BOOKING_ACTION)
    // action vazia ("") tem o mesmo tratamento que ausente
    assert.equal((await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ action: '' }, []) }))).ok, true)
  })
  it('sem action e SEM evidência de chave de teste (metadata ausente, false, "true", não-objeto): rejeitada', async () => {
    for (const metadata of [undefined, false, 'true', 1, [], {}, { result_with_testing_key: false }, { result_with_testing_key: 'true' }]) {
      const fetchImpl = metadata === undefined ? testingKeyResponse({}, ['action', 'metadata']) : testingKeyResponse({ metadata })
      const r = await verifyTurnstileToken(homolog({ fetchImpl }))
      assert.deepEqual(r, { ok: false, reason: 'action_mismatch', codes: [] }, JSON.stringify(metadata))
    }
  })
  it('sem action FORA da homologação (Production, outros Previews, local): rejeitada mesmo com metadata de teste', async () => {
    for (const policy of [bookingActionPolicy(false, TEST_READY), {}]) {
      const r = await verifyTurnstileToken(input({ expectedHostnames: HOMOLOG_HOSTS, fetchImpl: testingKeyResponse(), ...policy }))
      assert.deepEqual(r, { ok: false, reason: 'action_mismatch', codes: [] })
    }
  })
  it('chave secreta REAL com a opção ligada indevidamente: action ausente continua rejeitada', async () => {
    const r = await verifyTurnstileToken(homolog({ secretKey: '0x4AAAAAAAREALSECRETxxxxxxxxxxxx', fetchImpl: testingKeyResponse() }))
    assert.deepEqual(r, { ok: false, reason: 'action_mismatch', codes: [] })
  })
  it('action DIFERENTE (não ausente) continua rejeitada na homologação', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ action: 'outro_formulario' }, []) }))
    assert.deepEqual(r, { ok: false, reason: 'action_mismatch', codes: [] })
  })
  it('token inválido (success=false) é rejeitado mesmo com metadata de teste', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ success: false, 'error-codes': ['invalid-input-response'] }) }))
    assert.deepEqual(r, { ok: false, reason: 'invalid', codes: ['invalid-input-response'] })
    const r2 = await verifyTurnstileToken(homolog({ secretKey: K.secretAlwaysFails, fetchImpl: cloudflare() }))
    assert.equal(r2.ok, false)
  })
  it('hostname não autorizado é rejeitado antes da exceção de action', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ hostname: 'evil.example' }) }))
    assert.deepEqual(r, { ok: false, reason: 'hostname_mismatch', codes: [] })
  })
  it('token vencido continua rejeitado com a exceção ligada', async () => {
    const r = await verifyTurnstileToken(homolog({ fetchImpl: testingKeyResponse({ challenge_ts: '2026-10-29T17:00:00.000Z' }) }))
    assert.deepEqual(r, { ok: false, reason: 'expired_or_reused', codes: ['stale-challenge'] })
  })
  it('política: só homologação ativa + configuração pronta com AMBAS as chaves de teste liga a exceção', () => {
    assert.deepEqual(bookingActionPolicy(true, TEST_READY), { acceptedActionAliases: ['test'], allowMissingActionWithTestingKey: true })
    assert.deepEqual(bookingActionPolicy(false, TEST_READY), {})
    for (const cfg of [
      { status: 'ready', siteKey: '0x4AAAAAAFrhpHqMd6acN05s', secretKey: '0x4AAAAAAAREALSECRETxxxxxxxxxxxx', usingTestKeys: false },
      { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: '0x4AAAAAAAREALSECRETxxxxxxxxxxxx', usingTestKeys: true },
      { status: 'missing' }, { status: 'invalid' }, { status: 'test_keys_in_deployment' },
    ] as TurnstileConfig[]) assert.deepEqual(bookingActionPolicy(true, cfg), {}, JSON.stringify(cfg))
  })
  it('fluxo Production preservado: action do widget exigida, alias "test" recusado', async () => {
    const prod = bookingActionPolicy(false, { status: 'ready', siteKey: '0x4AAAAAAFrhpHqMd6acN05s', secretKey: '0x4AAAAAAAREALSECRETxxxxxxxxxxxx', usingTestKeys: false })
    assert.deepEqual(prod, {})
    const ok = await verifyTurnstileToken(input({ ...prod }))
    assert.equal(ok.ok, true)
    const alias = await verifyTurnstileToken(input({ ...prod, fetchImpl: cloudflare({ action: 'test' }) }))
    assert.deepEqual(alias, { ok: false, reason: 'action_mismatch', codes: [] })
  })
})
