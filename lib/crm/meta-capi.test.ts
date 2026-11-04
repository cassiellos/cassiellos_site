import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPI_MAX_ATTEMPTS, DEFAULT_GRAPH_API_VERSION, clientIpFrom, clientUserAgentFrom, dispatchScheduleToMeta, readCapiConfig,
  type CapiConfig, type CapiOutcome, type CapiStore, type DeliveryUpdate, type FetchLike, type ScheduleContext, type ScheduleGate,
} from './meta-capi'

// Valores sintéticos: nenhum token, IP ou user agent real.
const TOKEN = 'EAAsyntheticTOKENvalue0123456789abcdef'
const PIXEL = '28992534033707610'
const EVENT_ID = 'chronos_scheduled_d86977e9ce954efc95a1bfd19da2e698'
const IP = '203.0.113.7'
const UA = 'Mozilla/5.0 (synthetic test agent) AppleWebKit/537.36'
const NOW = Date.parse('2026-11-03T12:00:00Z')

const LIVE: CapiConfig = { mode: 'live', pixelId: PIXEL, accessToken: TOKEN, apiVersion: 'v26.0', testEventCode: null }
const TEST_MODE: CapiConfig = { mode: 'test', pixelId: PIXEL, accessToken: TOKEN, apiVersion: 'v26.0', testEventCode: 'TEST93849' }
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

function context(over: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    trackingId: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222',
    event_id: EVENT_ID, event_name: 'Chronos_Scheduled', occurred_at: new Date(NOW - 5_000),
    event_source_url: 'https://crm.cassiellos.com.br/agendar/odontologia',
    metadata: { formSlug: 'odontologia', environment: 'preview', isTest: false },
    leadIsTest: false, appointmentStatus: 'confirmed', homologationClaimed: false, ...over,
  }
}

/** Fila em memória com a mesma semântica da tabela (UNIQUE por tracking_event_id). */
function memoryStore(ctx: ScheduleContext | null, gates: ScheduleGate[] = [{ appointmentStatus: 'confirmed', consentGranted: true }]) {
  const rows = new Map<string, { id: string; payload: Record<string, unknown>; status: string; attempts: number; updates: DeliveryUpdate[] }>()
  let gateCalls = 0
  const store: CapiStore = {
    loadContext: async () => ctx,
    readGate: async () => gates[Math.min(gateCalls++, gates.length - 1)],
    claimDelivery: async (trackingId, payload) => {
      if (rows.has(trackingId)) return null
      const id = 'd' + (rows.size + 1)
      rows.set(trackingId, { id, payload, status: 'pending', attempts: 0, updates: [] })
      return id
    },
    markAttempt: async id => { for (const r of rows.values()) if (r.id === id) r.attempts += 1 },
    finish: async (id, update) => { for (const r of rows.values()) if (r.id === id) { r.status = update.status; r.updates.push(update) } },
  }
  return { store, rows, gateCalls: () => gateCalls }
}

type Call = { url: string; body: URLSearchParams; headers: Record<string, string> }
function fakeFetch(responses: Array<{ status: number; json?: unknown } | 'timeout' | 'network'>) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body), headers: init.headers })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e }
    if (next === 'network') throw new TypeError('fetch failed')
    return { status: next.status, json: async () => next.json ?? {} }
  }
  return { fetch, calls }
}
const OK = { status: 200, json: { events_received: 1, messages: [], fbtrace_id: 'AbCdEf123' } }

function run(config: CapiConfig, store: CapiStore, fetch: FetchLike, input: Partial<{ eventId: string; clientIp: string | null; userAgent: string | null }> = {}) {
  const logs: unknown[] = []
  const sleeps: number[] = []
  const done = dispatchScheduleToMeta(
    { config, store, fetch, now: () => NOW, sleep: async ms => { sleeps.push(ms) }, log: e => logs.push(e) },
    { eventId: EVENT_ID, clientIp: IP, userAgent: UA, ...input },
  )
  return { done, logs, sleeps }
}

function assertNoSecretsOrPii(value: unknown) {
  const text = JSON.stringify(value)
  for (const secret of [TOKEN, IP, UA, '@', 'whatsapp', '"em"', '"ph"', '"fn"', 'fbp', 'fbc', 'fbclid'])
    assert.equal(text.includes(secret), false, 'não pode conter ' + secret)
}

describe('CAPI Schedule — configuração (falha fechada)', () => {
  it('desligada por padrão e com valores inesperados; liga só com test|live + Pixel + token', () => {
    assert.deepEqual(readCapiConfig({}), { mode: 'off', reason: 'disabled' })
    for (const v of ['true', '1', 'LIVE', 'on', ' '])
      assert.equal(readCapiConfig({ META_CAPI_MODE: v, META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: TOKEN }).mode, 'off')
    assert.deepEqual(readCapiConfig({ META_CAPI_MODE: 'live', META_PIXEL_ID: PIXEL }), { mode: 'off', reason: 'missing_token' })
    assert.deepEqual(readCapiConfig({ META_CAPI_MODE: 'live', META_CAPI_ACCESS_TOKEN: TOKEN }), { mode: 'off', reason: 'missing_pixel' })
    assert.deepEqual(readCapiConfig({ META_CAPI_MODE: 'live', META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: 'abc def ghi jkl mno pqr' }),
      { mode: 'off', reason: 'missing_token' })
    assert.deepEqual(readCapiConfig({ META_CAPI_MODE: 'live', META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: TOKEN, META_GRAPH_API_VERSION: '26' }),
      { mode: 'off', reason: 'invalid_version' })
    const live = readCapiConfig({ META_CAPI_MODE: 'live', META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: TOKEN })
    assert.equal(live.mode, 'live')
    assert.equal(live.apiVersion, DEFAULT_GRAPH_API_VERSION) // assert.equal(live.mode, 'live') acima já estreita o tipo
    assert.equal(live.testEventCode, null)
    const test = readCapiConfig({ META_CAPI_MODE: 'test', META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: TOKEN, META_CAPI_TEST_EVENT_CODE: 'TEST93849' })
    assert.equal(test.mode !== 'off' && test.testEventCode, 'TEST93849')
    const badCode = readCapiConfig({ META_CAPI_MODE: 'test', META_PIXEL_ID: PIXEL, META_CAPI_ACCESS_TOKEN: TOKEN, META_CAPI_TEST_EVENT_CODE: 'x y' })
    assert.equal(badCode.mode !== 'off' && badCode.testEventCode, null)
  })

  it('IP e user agent: só valores válidos da própria requisição', () => {
    assert.equal(clientIpFrom(headers({ 'x-real-ip': IP })), IP)
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' })), '2001:db8::1')
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': 'not-an-ip' })), null)
    assert.equal(clientIpFrom(headers({})), null)
    assert.equal(clientUserAgentFrom(headers({ 'user-agent': UA })), UA)
    assert.equal(clientUserAgentFrom(headers({ 'user-agent': 'x' })), null)
    assert.equal(clientUserAgentFrom(headers({ 'user-agent': 'Mozilla\n/5.0 injected' })), null)
    assert.equal(clientUserAgentFrom(headers({ 'user-agent': 'M'.repeat(600) })), null)
  })
})

describe('CAPI Schedule — envio, deduplicação e falhas (Meta simulada)', () => {
  it('lead real com consentimento: 1 POST com o MESMO event_id do Pixel, token fora da URL, sem PII, aceito', async () => {
    const m = memoryStore(context())
    const f = fakeFetch([OK])
    const { done, logs } = run(LIVE, m.store, f.fetch)
    assert.deepEqual(await done, { status: 'accepted', attempts: 1, httpStatus: 200 })
    assert.equal(f.calls.length, 1)
    const call = f.calls[0]
    assert.equal(call.url, 'https://graph.facebook.com/v26.0/' + PIXEL + '/events')
    assert.equal(call.url.includes(TOKEN), false, 'token nunca na URL')
    assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.equal(call.body.get('access_token'), TOKEN)
    assert.equal(call.body.get('test_event_code'), null, 'fluxo comercial nunca leva test_event_code')
    const data = JSON.parse(call.body.get('data')!) as Array<Record<string, any>>
    assert.equal(data.length, 1)
    assert.deepEqual(data[0], {
      event_name: 'Schedule', event_time: Math.floor((NOW - 5_000) / 1000), event_id: EVENT_ID, action_source: 'website',
      event_source_url: 'https://crm.cassiellos.com.br/agendar/odontologia',
      user_data: { client_user_agent: UA, client_ip_address: IP },
      custom_data: { content_name: 'odontologia' },
    })
    const row = [...m.rows.values()][0]
    assert.equal(row.status, 'accepted')
    assert.equal(row.attempts, 1)
    assertNoSecretsOrPii(row.payload)
    assert.deepEqual(row.payload.userDataFields, ['client_user_agent', 'client_ip_address'])
    assert.deepEqual(row.updates.at(-1)?.response, { fbtrace_id: 'AbCdEf123', events_received: 1 })
    assertNoSecretsOrPii(logs)
  })

  it('sem IP válido continua enviando só o user agent (exigido); sem user agent nada sai', async () => {
    const f = fakeFetch([OK])
    assert.equal((await run(LIVE, memoryStore(context()).store, f.fetch, { clientIp: null }).done).status, 'accepted')
    assert.deepEqual(JSON.parse(f.calls[0].body.get('data')!)[0].user_data, { client_user_agent: UA })
    const g = fakeFetch([OK])
    const m = memoryStore(context())
    assert.deepEqual(await run(LIVE, m.store, g.fetch, { userAgent: null }).done, { status: 'skipped', reason: 'missing_user_agent' })
    assert.equal(g.calls.length, 0)
    assert.equal(m.rows.size, 0)
  })

  it('duplicidade: a mesma reunião processada de novo não gera segundo envio', async () => {
    const m = memoryStore(context())
    const f = fakeFetch([OK])
    assert.equal((await run(LIVE, m.store, f.fetch).done).status, 'accepted')
    assert.deepEqual(await run(LIVE, m.store, f.fetch).done, { status: 'duplicate' })
    const [a, b] = await Promise.all([run(LIVE, m.store, f.fetch).done, run(LIVE, m.store, f.fetch).done])
    assert.deepEqual([a, b], [{ status: 'duplicate' }, { status: 'duplicate' }])
    assert.equal(f.calls.length, 1)
    assert.equal(m.rows.size, 1)
  })

  it('429 e 5xx são temporários: nova tentativa com espera, mesmo event_id, depois aceito', async () => {
    const m = memoryStore(context())
    const f = fakeFetch([{ status: 429, json: { error: { code: 17 } } }, { status: 503 }, OK])
    const { done, sleeps } = run(LIVE, m.store, f.fetch)
    assert.deepEqual(await done, { status: 'accepted', attempts: 3, httpStatus: 200 })
    assert.deepEqual(sleeps, [2_000, 6_000])
    const ids = f.calls.map(c => JSON.parse(c.body.get('data')!)[0].event_id)
    assert.deepEqual(ids, [EVENT_ID, EVENT_ID, EVENT_ID])
    const row = [...m.rows.values()][0]
    assert.deepEqual(row.updates.map(u => u.status), ['retry', 'retry', 'accepted'])
    assert.equal(row.updates[0].error, 'http_429:17')
  })

  it('5xx persistente ou timeout: abandona após o limite de tentativas, sem lançar erro', async () => {
    for (const failure of [{ status: 500 }, 'timeout', 'network'] as const) {
      const m = memoryStore(context())
      const f = fakeFetch([failure])
      const outcome: CapiOutcome = await run(LIVE, m.store, f.fetch).done
      assert.equal(outcome.status, 'abandoned')
      assert.equal(f.calls.length, CAPI_MAX_ATTEMPTS)
      const expected = failure === 'timeout' ? 'timeout' : failure === 'network' ? 'network_error' : 'http_500'
      assert.equal('error' in outcome && outcome.error, expected)
      assert.equal([...m.rows.values()][0].status, 'abandoned')
    }
  })

  it('4xx definitivo é rejeitado na primeira resposta; erro transitório da Graph API tenta de novo', async () => {
    const m = memoryStore(context())
    const f = fakeFetch([{ status: 400, json: { error: { code: 100, error_subcode: 2804003, message: 'Invalid parameter', fbtrace_id: 'x' } } }])
    assert.deepEqual(await run(LIVE, m.store, f.fetch).done, { status: 'rejected', attempts: 1, httpStatus: 400, error: 'http_400:100/2804003' })
    assert.equal(f.calls.length, 1)
    const t = fakeFetch([{ status: 400, json: { error: { code: 2, is_transient: true } } }, OK])
    assert.equal((await run(LIVE, memoryStore(context()).store, t.fetch).done).status, 'accepted')
    assert.equal(t.calls.length, 2)
  })

  it('200 sem events_received = 1 não é tratado como aceito', async () => {
    const m = memoryStore(context())
    const outcome = await run(LIVE, m.store, fakeFetch([{ status: 200, json: { events_received: 0 } }]).fetch).done
    assert.equal(outcome.status, 'rejected')
    assert.equal([...m.rows.values()][0].status, 'rejected')
  })

  it('consentimento ausente ou revogado: nada sai; revogação entre tentativas interrompe o reenvio', async () => {
    const none = memoryStore(context(), [{ appointmentStatus: 'confirmed', consentGranted: false }])
    const f = fakeFetch([OK])
    assert.deepEqual(await run(LIVE, none.store, f.fetch).done, { status: 'skipped', reason: 'no_marketing_consent' })
    assert.equal(f.calls.length, 0)
    assert.equal(none.rows.size, 0, 'nada enfileirado sem consentimento')
    const revoked = memoryStore(context(), [
      { appointmentStatus: 'confirmed', consentGranted: true },
      { appointmentStatus: 'confirmed', consentGranted: false },
    ])
    const g = fakeFetch([{ status: 503 }, OK])
    const outcome = await run(LIVE, revoked.store, g.fetch).done
    assert.deepEqual(outcome, { status: 'abandoned', attempts: 1, httpStatus: 503, error: 'stopped:no_marketing_consent' })
    assert.equal(g.calls.length, 1)
  })

  it('reunião cancelada, pendente ou evento antigo (> 7 dias): nada sai', async () => {
    for (const status of ['cancelled', 'pending', 'rescheduled', null]) {
      const f = fakeFetch([OK])
      const outcome: CapiOutcome = await run(LIVE, memoryStore(context(), [{ appointmentStatus: status, consentGranted: true }]).store, f.fetch).done
      assert.deepEqual(outcome, { status: 'skipped', reason: 'appointment_not_confirmed' })
      assert.equal(f.calls.length, 0)
    }
    const old = fakeFetch([OK])
    assert.deepEqual(await run(LIVE, memoryStore(context({ occurred_at: new Date(NOW - 8 * 86_400_000) })).store, old.fetch).done,
      { status: 'skipped', reason: 'stale_event' })
    assert.equal(old.calls.length, 0)
  })

  it('lead de TESTE nunca entra no fluxo comercial (sem reserva de homologação ou sem código de teste)', async () => {
    const cases: Array<[CapiConfig, Partial<ScheduleContext>, string]> = [
      [LIVE, { metadata: { isTest: true }, leadIsTest: true }, 'test_or_unclassified'],
      [LIVE, { metadata: { formSlug: 'odontologia' }, leadIsTest: false }, 'test_or_unclassified'],
      [LIVE, { metadata: { isTest: false }, leadIsTest: true }, 'test_or_unclassified'],
      [LIVE, { metadata: { isTest: true }, leadIsTest: true, homologationClaimed: true }, 'missing_test_event_code'],
      [TEST_MODE, { metadata: { isTest: false }, leadIsTest: false }, 'live_disabled'],
    ]
    for (const [config, over, reason] of cases) {
      const f = fakeFetch([OK])
      assert.deepEqual(await run(config, memoryStore(context(over)).store, f.fetch).done, { status: 'skipped', reason })
      assert.equal(f.calls.length, 0)
    }
  })

  it('homologação: lead de teste + reserva do Schedule + código de teste => envio SEMPRE com test_event_code', async () => {
    const m = memoryStore(context({ metadata: { formSlug: 'odontologia', isTest: true }, leadIsTest: true, homologationClaimed: true }))
    const f = fakeFetch([OK])
    assert.equal((await run(TEST_MODE, m.store, f.fetch).done).status, 'accepted')
    assert.equal(f.calls[0].body.get('test_event_code'), 'TEST93849')
    const event = JSON.parse(f.calls[0].body.get('data')!)[0]
    assert.equal(event.event_id, EVENT_ID)
    assert.deepEqual(event.custom_data, { content_name: 'odontologia', cassiellos_teste: 'homologacao' })
    assert.equal([...m.rows.values()][0].payload.testEventCode, true)
    assertNoSecretsOrPii([...m.rows.values()][0].payload)
  })

  it('desligada: nenhuma leitura de banco, nenhum envio; erro interno nunca é lançado', async () => {
    let touched = false
    const store = { loadContext: async () => { touched = true; return null } } as unknown as CapiStore
    const f = fakeFetch([OK])
    assert.deepEqual(await run({ mode: 'off', reason: 'disabled' }, store, f.fetch).done, { status: 'skipped', reason: 'disabled' })
    assert.equal(touched, false)
    const broken: CapiStore = { ...memoryStore(context()).store, loadContext: async () => { throw new Error('db down') } }
    const outcome = await run(LIVE, broken, f.fetch).done
    assert.deepEqual(outcome, { status: 'abandoned', attempts: 0, httpStatus: null, error: 'internal_error' })
    assert.equal(f.calls.length, 0)
    assert.deepEqual(await run(LIVE, memoryStore(context()).store, f.fetch, { eventId: 'lead_abc' }).done,
      { status: 'skipped', reason: 'invalid_event' })
  })
})
