/**
 * Fase 2.2A — cliente HTTP de leitura do Sandbox, testado SÓ com transporte simulado (nenhuma chamada de rede).
 */
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { describe, it } from 'node:test'
import { errorFixture, FAKE_PII, FAKE_PRODUCTION_KEY, FAKE_SANDBOX_KEY, listFixture, paymentFixture, subscriptionFixture } from './fixtures'
import { ASAAS_SANDBOX_BASE_URL, AsaasHttpError, createAsaasSandboxGateway, redactSecrets, type AsaasTransport, type AsaasTransportRequest } from './http'
import { normalizePayment } from './types'

type Call = { url: string; init: AsaasTransportRequest }
function mock(handler: (url: string) => { status: number; body: unknown } | Promise<never>) {
  const calls: Call[] = []
  const transport: AsaasTransport = async (url, init) => {
    calls.push({ url, init })
    const r = await handler(url)
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }
  }
  return { calls, transport }
}
const enabled = (transport: AsaasTransport, o: Record<string, unknown> = {}) =>
  createAsaasSandboxGateway({ environment: 'sandbox', enabled: true, apiKey: FAKE_SANDBOX_KEY, transport, minIntervalMs: 0, sleep: async () => undefined, ...o })
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AsaasHttpError && e.code === code)

describe('cliente Asaas — ativação e ambiente', () => {
  it('desativado por padrão: nenhuma chamada sai, nem com transporte e chave', async () => {
    const m = mock(() => ({ status: 200, body: {} }))
    const g = createAsaasSandboxGateway({ environment: 'sandbox', apiKey: FAKE_SANDBOX_KEY, transport: m.transport })
    assert.equal(g.enabled, false)
    await rejects(g.getPayment('pay_ficticio0001'), 'ASAAS_HTTP_DISABLED')
    await rejects(g.listSubscriptionPayments('sub_ficticio0001'), 'ASAAS_HTTP_DISABLED')
    assert.equal(m.calls.length, 0)
    // existe sem credencial nenhuma
    await rejects(createAsaasSandboxGateway({ environment: 'sandbox' }).getSubscription('sub_ficticio0001'), 'ASAAS_HTTP_DISABLED')
  })
  it('production é recusado nesta fase; chave de produção é recusada no Sandbox', () => {
    assert.throws(() => createAsaasSandboxGateway({ environment: 'production' }), (e: AsaasHttpError) => e.code === 'PRODUCTION_NOT_ALLOWED_IN_THIS_PHASE')
    assert.throws(() => createAsaasSandboxGateway({ environment: 'sandbox', apiKey: FAKE_PRODUCTION_KEY }), (e: AsaasHttpError) => e.code === 'PRODUCTION_KEY_IN_SANDBOX')
  })
  it('ativado exige transporte injetado (nunca o fetch global) e chave no formato Sandbox', () => {
    assert.throws(() => createAsaasSandboxGateway({ environment: 'sandbox', enabled: true, apiKey: FAKE_SANDBOX_KEY }), (e: AsaasHttpError) => e.code === 'TRANSPORT_REQUIRED')
    const t: AsaasTransport = async () => ({ status: 200, text: async () => '{}' })
    for (const apiKey of [null, '', 'chave-qualquer', '$aact_hmlg_curta']) {
      assert.throws(() => createAsaasSandboxGateway({ environment: 'sandbox', enabled: true, apiKey, transport: t }), (e: AsaasHttpError) => e.code === 'INVALID_SANDBOX_KEY')
    }
    for (const timeoutMs of [0, 50, 60_000, 1.5]) {
      assert.throws(() => createAsaasSandboxGateway({ environment: 'sandbox', timeoutMs }), (e: AsaasHttpError) => e.code === 'INVALID_TIMEOUT')
    }
  })
  it('URL base exclusiva do Sandbox', async () => {
    assert.equal(ASAAS_SANDBOX_BASE_URL, 'https://api-sandbox.asaas.com/v3')
    const m = mock(() => ({ status: 200, body: paymentFixture('pay_ficticio0001', null) }))
    await enabled(m.transport).getPayment('pay_ficticio0001')
    assert.equal(m.calls[0].url, 'https://api-sandbox.asaas.com/v3/payments/pay_ficticio0001')
    assert.equal(m.calls[0].init.method, 'GET')
  })
})

describe('cliente Asaas — leitura', () => {
  it('lê cliente, assinatura e cobrança (somente GET), conferindo tipo e id do objeto', async () => {
    const m = mock(url => {
      if (url.endsWith('/customers/cus_ficticio000000001')) return { status: 200, body: { object: 'customer', id: 'cus_ficticio000000001' } }
      if (url.endsWith('/subscriptions/sub_ficticio0001')) return { status: 200, body: subscriptionFixture('sub_ficticio0001') }
      return { status: 200, body: paymentFixture('pay_ficticio0001', 'sub_ficticio0001') }
    })
    const g = enabled(m.transport)
    assert.equal((await g.getCustomer('cus_ficticio000000001') as { id: string }).id, 'cus_ficticio000000001')
    assert.equal((await g.getSubscription('sub_ficticio0001') as { cycle: string }).cycle, 'MONTHLY')
    assert.equal(normalizePayment(await g.getPayment('pay_ficticio0001')).valueCents, 6990)
    assert.ok(m.calls.every(c => c.init.method === 'GET'))
    // nenhuma operação de escrita existe no cliente
    for (const k of Object.keys(g)) assert.match(k, /^(environment|baseUrl|enabled|get[A-Z]\w+|list[A-Z]\w+)$/)
  })
  it('id inválido nunca vira caminho (sem injeção de rota)', async () => {
    const m = mock(() => ({ status: 200, body: {} }))
    const g = enabled(m.transport)
    for (const bad of ['../customers', 'pay_1/../../x', 'pay_1?x=1', 'sub_1', '']) await rejects(g.getPayment(bad), 'INVALID_PAYMENT_ID')
    await rejects(g.getSubscription('pay_x0001'), 'INVALID_SUBSCRIPTION_ID')
    await rejects(g.getCustomer('cus_a/b'), 'INVALID_CUSTOMER_ID')
    assert.equal(m.calls.length, 0)
  })
  it('objeto de outro tipo ou de outro id é recusado', async () => {
    await rejects(enabled(mock(() => ({ status: 200, body: { object: 'subscription', id: 'pay_ficticio0001' } })).transport).getPayment('pay_ficticio0001'), 'ASAAS_UNEXPECTED_OBJECT')
    await rejects(enabled(mock(() => ({ status: 200, body: paymentFixture('pay_outro000001', null) })).transport).getPayment('pay_ficticio0001'), 'ASAAS_ID_MISMATCH')
  })
  it('paginação das cobranças da assinatura (offset/limit) até hasMore=false; limites de segurança', async () => {
    const pages = [listFixture([paymentFixture('pay_p1', 'sub_s1')], true, 0), listFixture([paymentFixture('pay_p2', 'sub_s1')], false, 100)]
    const m = mock(url => ({ status: 200, body: pages[Number(new URL(url).searchParams.get('offset')) / 100] }))
    const all = await enabled(m.transport).listSubscriptionPayments('sub_s1')
    assert.deepEqual(all.map(p => (p as { id: string }).id), ['pay_p1', 'pay_p2'])
    assert.equal(m.calls[0].url, 'https://api-sandbox.asaas.com/v3/subscriptions/sub_s1/payments?offset=0&limit=100')
    await rejects(enabled(mock(() => ({ status: 200, body: listFixture([], true) })).transport).listSubscriptionPayments('sub_s1'), 'ASAAS_INVALID_PAGINATION')
    await rejects(enabled(mock(() => ({ status: 200, body: listFixture([{ id: 'x' }], true) })).transport).listSubscriptionPayments('sub_s1'), 'ASAAS_TOO_MANY_PAGES')
    await rejects(enabled(mock(() => ({ status: 200, body: { object: 'list' } })).transport).listSubscriptionPayments('sub_s1'), 'ASAAS_INVALID_RESPONSE')
  })
})

describe('cliente Asaas — erros, tempo-limite e credenciais', () => {
  it('respostas de erro viram códigos curtos; descrição (com dados) nunca é repassada', async () => {
    const cases: [number, string][] = [[400, 'ASAAS_BAD_REQUEST'], [401, 'ASAAS_UNAUTHORIZED'], [403, 'ASAAS_FORBIDDEN'], [404, 'ASAAS_NOT_FOUND'],
      [429, 'ASAAS_RATE_LIMITED'], [500, 'ASAAS_UPSTREAM_ERROR'], [503, 'ASAAS_UPSTREAM_ERROR'], [302, 'ASAAS_UNEXPECTED_STATUS']]
    for (const [status, code] of cases) {
      const err = await enabled(mock(() => ({ status, body: errorFixture('invalid_action') })).transport).getPayment('pay_ficticio0001').catch(e => e)
      assert.ok(err instanceof AsaasHttpError && err.code === code && err.status === status, String(status))
      assert.deepEqual(err.asaasCodes, ['invalid_action'])
      assert.ok(!JSON.stringify({ ...err, m: err.message }).includes(FAKE_PII.email))
    }
  })
  it('JSON inválido, corpo vazio, lista no lugar de objeto e resposta grande demais', async () => {
    await rejects(enabled(mock(() => ({ status: 200, body: '<html>' })).transport).getPayment('pay_ficticio0001'), 'ASAAS_INVALID_JSON')
    await rejects(enabled(mock(() => ({ status: 200, body: '' })).transport).getPayment('pay_ficticio0001'), 'ASAAS_INVALID_RESPONSE')
    await rejects(enabled(mock(() => ({ status: 200, body: [] })).transport).getPayment('pay_ficticio0001'), 'ASAAS_INVALID_RESPONSE')
    await rejects(enabled(mock(() => ({ status: 200, body: 'x'.repeat(600 * 1024) })).transport).getPayment('pay_ficticio0001'), 'ASAAS_RESPONSE_TOO_LARGE')
  })
  it('tempo-limite aborta a requisição; falha de rede não vaza a mensagem do transporte', async () => {
    const slow: AsaasTransport = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted ' + FAKE_SANDBOX_KEY))))
    const t0 = Date.now()
    await rejects(enabled(slow, { timeoutMs: 150 }).getPayment('pay_ficticio0001'), 'ASAAS_TIMEOUT')
    assert.ok(Date.now() - t0 < 2000)
    const broken: AsaasTransport = async () => { throw new Error('ECONNREFUSED access_token=' + FAKE_SANDBOX_KEY) }
    const err = await enabled(broken).getPayment('pay_ficticio0001').catch((e: AsaasHttpError) => e) as AsaasHttpError
    assert.equal(err.code, 'ASAAS_NETWORK_ERROR')
    assert.ok(!err.message.includes('aact') && !String(err.stack).includes(FAKE_SANDBOX_KEY))
  })
  it('a chave só vai no cabeçalho access_token: não é propriedade, não aparece em JSON/inspect/erros', async () => {
    const m = mock(() => ({ status: 401, body: errorFixture('invalid_access_token') }))
    const g = enabled(m.transport)
    const err = await g.getPayment('pay_ficticio0001').catch((e: AsaasHttpError) => e) as AsaasHttpError
    assert.equal(m.calls[0].init.headers.access_token, FAKE_SANDBOX_KEY)
    assert.ok(!m.calls[0].url.includes('aact'), 'chave nunca na URL')
    for (const text of [JSON.stringify(g), inspect(g, { depth: 5, showHidden: true }), JSON.stringify(err), String(err.stack), Object.values(g).join(' ')]) {
      assert.ok(!text.includes(FAKE_SANDBOX_KEY), 'chave exposta')
    }
    assert.ok(Object.isFrozen(g))
  })
  it('redactSecrets remove chaves de qualquer texto de registro', () => {
    assert.equal(redactSecrets('falha com ' + FAKE_SANDBOX_KEY + ' e ' + FAKE_PRODUCTION_KEY), 'falha com [redacted] e [redacted]')
    assert.equal(redactSecrets('{"access_token":"abc123"}'), '{"access_token=[redacted]"}')
  })
})
