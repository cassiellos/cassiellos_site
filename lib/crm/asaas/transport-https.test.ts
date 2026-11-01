/**
 * Fase 2.2B — transporte HTTPS real, testado com requisição de baixo nível SIMULADA (nenhuma conexão é aberta).
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { describe, it } from 'node:test'
import { FAKE_SANDBOX_KEY } from './fixtures'
import { AsaasHttpError, createAsaasSandboxGateway, type AsaasTransportRequest } from './http'
import { assertSandboxUrl, createSandboxHttpsTransport, SANDBOX_HOST, type LowLevelRequest } from './transport-https'

type Reply = { status: number; headers?: Record<string, string>; chunks?: string[]; error?: boolean; hang?: boolean }
function fakeRequest(reply: Reply) {
  const calls: RequestOptions[] = []
  let ended = 0
  let destroyed = 0
  const request: LowLevelRequest = (options, onResponse) => {
    calls.push(options)
    const req = new EventEmitter() as EventEmitter & { setTimeout(ms: number): void; destroy(): void; end(): void; write?: unknown }
    req.setTimeout = () => undefined
    req.destroy = () => { destroyed++ }
    req.end = () => {
      ended++
      if (reply.hang) return
      if (reply.error) { setImmediate(() => req.emit('error', new Error('connect ECONNREFUSED access_token=' + FAKE_SANDBOX_KEY))); return }
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume(): void }
      res.statusCode = reply.status
      res.headers = reply.headers ?? {}
      res.resume = () => undefined
      setImmediate(() => {
        onResponse(res as never)
        for (const c of reply.chunks ?? []) res.emit('data', Buffer.from(c))
        res.emit('end')
      })
    }
    return req
  }
  return { request, calls, ended: () => ended, destroyed: () => destroyed }
}
const GET = (o: Partial<AsaasTransportRequest> = {}): AsaasTransportRequest =>
  ({ method: 'GET', headers: { accept: 'application/json', access_token: FAKE_SANDBOX_KEY }, signal: new AbortController().signal, ...o })
const URL_OK = 'https://api-sandbox.asaas.com/v3/customers?offset=0&limit=1'
const codeOf = (c: string) => (e: unknown) => e instanceof AsaasHttpError && e.code === c

describe('transporte HTTPS do Sandbox — barreiras de execução', () => {
  it('GET autorizado: host fixo, porta 443, TLS verificado, sem corpo, cabeçalhos permitidos', async () => {
    const f = fakeRequest({ status: 200, chunks: ['{"object":"list","hasMore":false,"data":[]}'], headers: { 'retry-after': '3' } })
    const res = await createSandboxHttpsTransport({ request: f.request })(URL_OK, GET())
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"object":"list","hasMore":false,"data":[]}')
    assert.equal(res.headers?.get('Retry-After'), '3')
    const o = f.calls[0] as RequestOptions & { rejectUnauthorized: boolean; minVersion: string; servername: string }
    assert.deepEqual([o.method, o.hostname, o.port, o.path, o.protocol, o.servername], ['GET', SANDBOX_HOST, 443, '/v3/customers?offset=0&limit=1', 'https:', SANDBOX_HOST])
    assert.equal(o.rejectUnauthorized, true)
    assert.equal(o.minVersion, 'TLSv1.2')
    assert.equal(SANDBOX_HOST, 'api-sandbox.asaas.com')
  })
  it('POST, PUT, PATCH, DELETE, HEAD (mesmo por uso indevido do tipo) e corpo: recusados antes de abrir conexão', async () => {
    const f = fakeRequest({ status: 200 })
    const t = createSandboxHttpsTransport({ request: f.request })
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'get', undefined]) {
      await assert.rejects(t(URL_OK, { ...GET(), method } as never), codeOf('METHOD_NOT_ALLOWED'), String(method))
    }
    await assert.rejects(t(URL_OK, { ...GET(), body: '{}' } as never), codeOf('BODY_NOT_ALLOWED'))
    assert.equal(f.calls.length, 0)
  })
  it('URL de produção, http, outro host, porta, usuário, fragmento e travessia de caminho: recusados', async () => {
    const f = fakeRequest({ status: 200 })
    const t = createSandboxHttpsTransport({ request: f.request })
    for (const bad of ['https://api.asaas.com/v3/customers', 'https://www.asaas.com/api/v3/customers', 'http://api-sandbox.asaas.com/v3/customers',
      'https://api-sandbox.asaas.com.evil.example/v3/customers', 'https://evil.example/v3/customers', 'https://api-sandbox.asaas.com:8443/v3/customers',
      'https://user:pw@api-sandbox.asaas.com/v3/customers', 'https://api-sandbox.asaas.com/v3/customers#x', 'https://api-sandbox.asaas.com/v2/customers',
      'https://api-sandbox.asaas.com/v3/../v3/customers', 'https://api-sandbox.asaas.com/v3/%2e%2e/x', 'https://api-sandbox.asaas.com/v3', 'nao-e-url',
      'https://API-SANDBOX.asaas.com/v3/customers', 'https://api-sandbox.asaas.com@evil.example/v3/customers']) {
      await assert.rejects(t(bad, GET()), codeOf('URL_NOT_ALLOWED'), bad)
      assert.throws(() => assertSandboxUrl(bad))
    }
    assert.equal(f.calls.length, 0)
  })
  it('cabeçalhos fora da lista (ou com quebra de linha) são recusados', async () => {
    const t = createSandboxHttpsTransport({ request: fakeRequest({ status: 200 }).request })
    await assert.rejects(t(URL_OK, GET({ headers: { cookie: 'x' } })), codeOf('HEADER_NOT_ALLOWED'))
    await assert.rejects(t(URL_OK, GET({ headers: { access_token: 'a\r\nHost: evil' } })), codeOf('HEADER_NOT_ALLOWED'))
  })
  it('redirecionamento (301/302/307/308) nunca é seguido: a chave não vai a outro destino', async () => {
    for (const status of [301, 302, 307, 308]) {
      const f = fakeRequest({ status, headers: { location: 'https://evil.example/collect' } })
      await assert.rejects(createSandboxHttpsTransport({ request: f.request })(URL_OK, GET()), codeOf('ASAAS_REDIRECT_BLOCKED'))
      assert.equal(f.calls.length, 1, 'nenhuma segunda requisição')
    }
  })
  it('resposta grande demais é abortada durante a leitura', async () => {
    const f = fakeRequest({ status: 200, chunks: ['x'.repeat(600), 'y'.repeat(600)] })
    await assert.rejects(createSandboxHttpsTransport({ request: f.request, maxBytes: 1000 })(URL_OK, GET()), codeOf('ASAAS_RESPONSE_TOO_LARGE'))
    assert.ok(f.destroyed() >= 1)
  })
  it('tempo-limite (sinal abortado) e erro de rede: códigos curtos, sem a mensagem do Node', async () => {
    const hang = fakeRequest({ status: 200, hang: true })
    const ac = new AbortController()
    const p = createSandboxHttpsTransport({ request: hang.request })(URL_OK, GET({ signal: ac.signal }))
    ac.abort()
    await assert.rejects(p, codeOf('ASAAS_TIMEOUT'))
    const err = await createSandboxHttpsTransport({ request: fakeRequest({ status: 0, error: true }).request })(URL_OK, GET()).catch((e: Error) => e)
    assert.ok(codeOf('ASAAS_NETWORK_ERROR')(err))
    assert.ok(!JSON.stringify(err).includes('aact') && !String((err as Error).stack).includes(FAKE_SANDBOX_KEY))
  })
  it('integrado ao cliente: 429 com Retry-After é respeitado e as tentativas são limitadas', async () => {
    let n = 0
    const request: LowLevelRequest = (o, cb) => fakeRequest(++n < 3 ? { status: 429, headers: { 'retry-after': '2' }, chunks: ['{}'] }
      : { status: 200, chunks: ['{"object":"list","hasMore":false,"totalCount":0,"limit":1,"offset":0,"data":[]}'] }).request(o, cb)
    const waits: number[] = []
    const g = createAsaasSandboxGateway({ environment: 'sandbox', enabled: true, apiKey: FAKE_SANDBOX_KEY, minIntervalMs: 0,
      transport: createSandboxHttpsTransport({ request }), sleep: async ms => { waits.push(ms) } })
    assert.equal((await g.listPage('customers', 0, 1)).totalCount, 0)
    assert.deepEqual(waits, [2000, 2000])
  })
})
