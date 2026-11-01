/**
 * Fase 2.2B — consulta somente leitura (relatório sanitizado), com transporte SIMULADO e chave FICTÍCIA.
 * Também cobre retentativas, orçamento e erros do cliente HTTP exigidos nesta fase.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { customerFixture, FAKE_PII, FAKE_SANDBOX_KEY, listFixture } from './fixtures'
import { AsaasHttpError, createAsaasSandboxGateway, parseRetryAfter, type AsaasRequestInfo, type AsaasTransport } from './http'
import { runSandboxReadProbe } from './probe'

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ status, text: async () => JSON.stringify(body), headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } })
const noWait = async () => undefined
const codeOf = (c: string) => (e: unknown) => e instanceof AsaasHttpError && e.code === c
const emptyList = (limit: number) => ({ ...listFixture([]), totalCount: 0, limit, offset: 0 })

describe('consulta somente leitura ao Sandbox (relatório sanitizado)', () => {
  it('conta vazia: 4 GETs de listagem, zero registros, sem chave/cabeçalhos/valores no relatório', async () => {
    const urls: string[] = []
    const methods: string[] = []
    const transport: AsaasTransport = async (url, init) => {
      urls.push(url); methods.push(init.method)
      return reply(200, emptyList(Number(new URL(url).searchParams.get('limit'))))
    }
    const r = await runSandboxReadProbe({ apiKey: FAKE_SANDBOX_KEY, transport, sleep: noWait })
    assert.deepEqual(urls, ['https://api-sandbox.asaas.com/v3/customers?offset=0&limit=1', 'https://api-sandbox.asaas.com/v3/customers?offset=0&limit=10',
      'https://api-sandbox.asaas.com/v3/payments?offset=0&limit=10', 'https://api-sandbox.asaas.com/v3/subscriptions?offset=0&limit=10'])
    assert.ok(methods.every(m => m === 'GET'))
    assert.deepEqual(r.steps.map(s => [s.test, s.endpoint, s.ok, s.status, s.summary?.totalCount, s.summary?.returned]), [
      ['1-autenticacao', 'GET /v3/customers', true, 200, 0, 0], ['2-clientes', 'GET /v3/customers', true, 200, 0, 0],
      ['3-cobrancas', 'GET /v3/payments', true, 200, 0, 0], ['4-assinaturas', 'GET /v3/subscriptions', true, 200, 0, 0]])
    assert.equal(r.stoppedEarly, null)
    assert.deepEqual(r.contractNotes, [])
    assert.ok(r.steps.every(s => typeof s.ms === 'number'))
    assert.ok(!JSON.stringify(r).includes('aact'))
  })
  it('com registros: relatório traz só NOMES de campos e conferência de ids — nunca valores pessoais', async () => {
    const transport: AsaasTransport = async () => reply(200, { ...listFixture([customerFixture('cus_ficticio000000001')]), totalCount: 1, limit: 10, offset: 0 })
    const r = await runSandboxReadProbe({ apiKey: FAKE_SANDBOX_KEY, transport, sleep: noWait })
    const text = JSON.stringify(r)
    for (const v of Object.values(FAKE_PII)) assert.ok(!text.includes(v), v)
    assert.ok(r.steps[1].summary!.itemFields.includes('cpfCnpj'))
    assert.equal(r.steps[1].summary!.idsMatchFormat, true)
    assert.equal(r.steps[2].summary!.idsMatchFormat, false, 'id de cliente numa listagem de cobranças não confere')
    assert.ok(r.contractNotes.some(n => n.startsWith('1-autenticacao: limit devolvido')))
  })
  it('401 na autenticação: para imediatamente (sem insistir), código sanitizado', async () => {
    let calls = 0
    const r = await runSandboxReadProbe({ apiKey: FAKE_SANDBOX_KEY, sleep: noWait,
      transport: async () => { calls++; return reply(401, { errors: [{ code: 'invalid_access_token', description: 'chave ' + FAKE_SANDBOX_KEY }] }) } })
    assert.equal(calls, 1)
    assert.deepEqual([r.stoppedEarly, r.steps.length, r.steps[0].status, r.steps[0].code], ['AUTENTICACAO_RECUSADA', 1, 401, 'ASAAS_UNAUTHORIZED'])
    assert.ok(!JSON.stringify(r).includes('aact'))
  })
  it('403 também para; 429 persistente para sem provocar mais limitação', async () => {
    assert.equal((await runSandboxReadProbe({ apiKey: FAKE_SANDBOX_KEY, sleep: noWait, transport: async () => reply(403, {}) })).stoppedEarly, 'AUTENTICACAO_RECUSADA')
    let calls = 0
    const r = await runSandboxReadProbe({ apiKey: FAKE_SANDBOX_KEY, sleep: noWait, transport: async () => { calls++; return reply(429, {}, { 'retry-after': '1' }) } })
    assert.equal(r.stoppedEarly, 'LIMITE_DE_REQUISICOES')
    assert.equal(calls, 2, 'uma tentativa + uma retentativa')
  })
})

describe('cliente HTTP — retentativas, limites e observação sanitizada', () => {
  const gw = (transport: AsaasTransport, o: Record<string, unknown> = {}) => createAsaasSandboxGateway({ environment: 'sandbox', enabled: true,
    apiKey: FAKE_SANDBOX_KEY, transport, minIntervalMs: 0, sleep: noWait, ...o })
  it('500 e 401/403 não são repetidos; 503 é repetido no máximo maxRetries vezes', async () => {
    for (const [status, expected] of [[500, 1], [401, 1], [403, 1], [503, 3]] as const) {
      let n = 0
      await assert.rejects(gw(async () => { n++; return reply(status, {}) }).listPage('payments'))
      assert.equal(n, expected, String(status))
    }
  })
  it('Retry-After acima de 30 s: falha logo (não fica preso) e informa os segundos', async () => {
    let n = 0
    const err = await gw(async () => { n++; return reply(429, {}, { 'retry-after': '120' }) }).listPage('customers').catch((e: AsaasHttpError) => e)
    assert.ok(codeOf('ASAAS_RATE_LIMITED')(err))
    assert.equal((err as AsaasHttpError).retryAfterSeconds, 120)
    assert.equal(n, 1)
    assert.equal(parseRetryAfter('5'), 5000)
    assert.equal(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())! > 8000, true)
    assert.equal(parseRetryAfter('amanhã'), null)
  })
  it('orçamento de requisições e intervalo mínimo entre chamadas', async () => {
    const g = gw(async () => reply(200, emptyList(10)), { maxRequests: 2 })
    await g.listPage('customers'); await g.listPage('payments')
    await assert.rejects(g.listPage('subscriptions'), codeOf('ASAAS_REQUEST_BUDGET_EXCEEDED'))
    const waits: number[] = []
    const h = gw(async () => reply(200, emptyList(10)), { minIntervalMs: 400, sleep: async (ms: number) => { waits.push(ms) } })
    await h.listPage('customers'); await h.listPage('customers')
    assert.equal(waits.length, 1)
    assert.ok(waits[0] > 300 && waits[0] <= 400)
  })
  it('listPage: recurso, offset e limite validados; resposta malformada recusada', async () => {
    const g = gw(async () => reply(200, emptyList(10)))
    await assert.rejects(g.listPage('webhooks' as never), codeOf('INVALID_RESOURCE'))
    await assert.rejects(g.listPage('customers', -1), codeOf('INVALID_OFFSET'))
    await assert.rejects(g.listPage('customers', 0, 101), codeOf('INVALID_LIMIT'))
    await assert.rejects(gw(async () => reply(200, { object: 'list', data: {} })).listPage('customers'), codeOf('ASAAS_INVALID_RESPONSE'))
    await assert.rejects(gw(async () => reply(200, { data: [], hasMore: false })).listPage('customers'), codeOf('ASAAS_INVALID_RESPONSE'))
  })
  it('observador recebe só método, caminho sem query, status, duração e código — sem chave nem cabeçalhos', async () => {
    const infos: AsaasRequestInfo[] = []
    await gw(async () => reply(401, {}), { onRequest: (i: AsaasRequestInfo) => infos.push(i) }).listPage('customers', 0, 5).catch(() => undefined)
    assert.deepEqual(Object.keys(infos[0]).sort(), ['attempt', 'code', 'method', 'ms', 'path', 'status'])
    assert.deepEqual([infos[0].path, infos[0].status, infos[0].code], ['/customers', 401, 'ASAAS_UNAUTHORIZED'])
    assert.ok(!JSON.stringify(infos).includes('aact'))
  })
  it('integração desativada funciona sem credenciais e não chama o transporte', async () => {
    let n = 0
    const g = createAsaasSandboxGateway({ environment: 'sandbox', transport: async () => { n++; return reply(200, {}) } })
    await assert.rejects(g.listPage('customers'), codeOf('ASAAS_HTTP_DISABLED'))
    assert.equal(n, 0)
  })
})
