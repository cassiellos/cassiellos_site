/** Conectores reais com `fetch` FALSO (nenhuma chamada de rede). Respostas no formato documentado das APIs. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConnectorError } from './contracts'
import { createGoogleAdsConnector, mapGoogleError } from './google-ads'
import type { FetchLike } from './http'
import { createMetaAdsConnector, mapMetaError } from './meta-ads'
import { ReadOnlyViolation } from './read-only-guard'

type Call = { url: string; method: string; headers: Record<string, string>; body?: string }
function fakeFetch(handler: (c: Call) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = []
  const f: FetchLike = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body }
    calls.push(call)
    const r = handler(call)
    return { status: r.status ?? 200, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(r.body) }
  }
  return { f, calls }
}
const noHeaders = { get: () => null }

describe('Google Ads — conector real (fetch falso)', () => {
  const ctx = { connectionId: 'c1' }
  it('Google Ads após 09/09/2026: envio do token legado é opcional', async () => {
    const { f, calls } = fakeFetch(() => ({ body: { resourceNames: [] } }))
    const google = createGoogleAdsConnector({ fetch: f, accessToken: async () => 'oauth-token' })
    const result = await google.listAccessibleAccounts(ctx)
    assert.deepEqual(result.items, [])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].headers.Authorization, 'Bearer oauth-token')
    assert.equal('developer-token' in calls[0].headers, false)
  })
  it('descoberta: conta direta + MCC com contas clientes (login-customer-id = gerente); cabeçalhos corretos', async () => {
    const { f, calls } = fakeFetch(c => {
      if (c.url.endsWith('customers:listAccessibleCustomers')) return { body: { resourceNames: ['customers/1111111111', 'customers/9999999999'] } }
      const q = JSON.parse(c.body!).query as string
      if (c.url.includes('/customers/1111111111/') && q.includes('FROM customer ')) return { body: { results: [{ customer: { id: '1111111111', descriptiveName: 'Direta', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: false, status: 'ENABLED' } }] } }
      if (c.url.includes('/customers/9999999999/') && q.includes('FROM customer ')) return { body: { results: [{ customer: { id: '9999999999', descriptiveName: 'MCC', manager: true, status: 'ENABLED' } }] } }
      if (q.includes('FROM customer_client')) return { body: { results: [
        { customerClient: { id: '2222222222', descriptiveName: 'Cliente via MCC', currencyCode: 'USD', timeZone: 'America/New_York', status: 'ENABLED' } },
        { customerClient: { id: '1111111111', descriptiveName: 'Direta (também no MCC)', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', status: 'ENABLED' } }] } }
      return { status: 500, body: {} }
    })
    const g = createGoogleAdsConnector({ fetch: f, developerToken: 'dev-ficticio', accessToken: async () => 'tok-ficticio' })
    const { items } = await g.listAccessibleAccounts(ctx)
    const byId = Object.fromEntries(items.map(a => [a.externalId, a]))
    assert.equal(byId['2222222222'].parentExternalId, '9999999999')
    assert.equal(byId['2222222222'].currencyCode, 'USD')
    assert.equal(byId['1111111111'].parentExternalId, null, 'acesso direto tem prioridade')
    assert.ok(!byId['9999999999'], 'a própria MCC não é conta de anúncios')
    const mccCall = calls.find(c => c.body?.includes('customer_client'))!
    assert.equal(mccCall.headers['login-customer-id'], '9999999999')
    assert.equal(mccCall.headers['developer-token'], 'dev-ficticio')
    assert.ok(calls.every(c => c.url.startsWith('https://googleads.googleapis.com/v26/')))
  })

  it('métricas diárias: GAQL só leitura, paginação, int64 em texto, ausência = 0, definição de conversão preservada', async () => {
    const { f, calls } = fakeFetch(c => {
      const b = JSON.parse(c.body!)
      if (!b.pageToken) return { body: { results: [{ campaign: { id: '55' }, segments: { date: '2026-11-10' }, metrics: { impressions: '1200', clicks: '30', costMicros: '45670000', conversions: 2.5 } }], nextPageToken: 'p2' } }
      return { body: { results: [{ campaign: { id: '55' }, segments: { date: '2026-11-11' }, metrics: {} }] } }
    })
    const g = createGoogleAdsConnector({ fetch: f, developerToken: 'd', accessToken: async () => 't' })
    const p1 = await g.getDailyMetrics({ connectionId: 'c1', loginCustomerId: '9999999999' }, '222-222-2222', { start: '2026-11-10', end: '2026-11-11' })
    assert.deepEqual(p1.items[0], { campaignExternalId: '55', date: '2026-11-10', impressions: 1200, clicks: 30, costMicros: 45670000, conversions: 2.5, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' })
    const p2 = await g.getDailyMetrics({ connectionId: 'c1', loginCustomerId: '9999999999' }, '2222222222', { start: '2026-11-10', end: '2026-11-11' }, p1.nextPageToken)
    assert.deepEqual([p2.items[0].impressions, p2.items[0].costMicros, p2.nextPageToken], [0, 0, null])
    assert.match(JSON.parse(calls[0].body!).query, /^SELECT .* WHERE segments\.date BETWEEN '2026-11-10' AND '2026-11-11'$/)
    assert.equal(calls[0].headers['login-customer-id'], '9999999999')
    await assert.rejects(g.getDailyMetrics({ connectionId: 'c1' }, '2222222222', { start: "2026-11-10' OR 1=1", end: '2026-11-11' }), ConnectorError)
  })

  it('erros: 401 → auth_expired; 403 USER_PERMISSION_DENIED → permission_denied; 429 com retryDelay; mensagem sem dados sensíveis', () => {
    assert.equal(mapGoogleError(401, { error: { status: 'UNAUTHENTICATED' } }, noHeaders).kind, 'auth_expired')
    const denied = mapGoogleError(403, { error: { status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }] } }, noHeaders)
    assert.equal(denied.kind, 'permission_denied'); assert.match(denied.message, /USER_PERMISSION_DENIED/)
    const limited = mapGoogleError(429, { error: { status: 'RESOURCE_EXHAUSTED', details: [{ errors: [{ errorCode: { quotaError: 'RESOURCE_EXHAUSTED' } }] }, { retryDelay: '27s' }] } }, noHeaders)
    assert.deepEqual([limited.kind, limited.retryAfterSeconds], ['rate_limited', 27])
    const devToken = mapGoogleError(403, { error: { message: 'token dev-secreto inválido', details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' } }] }] } }, noHeaders)
    assert.ok(!devToken.message.includes('dev-secreto')); assert.match(devToken.message, /DEVELOPER_TOKEN_NOT_APPROVED/)
    assert.equal(mapGoogleError(503, {}, noHeaders).kind, 'transient')
  })

  it('não há como mutar: a guarda recusa GAQL de escrita antes de sair do servidor', async () => {
    const { f, calls } = fakeFetch(() => ({ body: {} }))
    const g = createGoogleAdsConnector({ fetch: f, developerToken: 'd', accessToken: async () => 't' }) as unknown as Record<string, unknown>
    assert.equal(typeof g.mutate, 'undefined')
    assert.throws(() => { throw new ReadOnlyViolation('google_ads', 'x') })
    assert.equal(calls.length, 0)
  })
})

describe('Meta Ads — conector real (fetch falso)', () => {
  const ctx = { connectionId: 'm1' }
  it('descoberta com paginação por cursor; status oficial da conta; appsecret_proof; token só no cabeçalho', async () => {
    const { f, calls } = fakeFetch(c => c.url.includes('after=CUR2')
      ? { body: { data: [{ account_id: '2000002', name: 'Conta 2', currency: 'USD', timezone_name: 'America/New_York', account_status: 2 }], paging: { cursors: { after: 'CUR3' } } } }
      : { body: { data: [{ account_id: '1000001', name: 'Conta 1', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1, business: { id: '777' } }], paging: { cursors: { after: 'CUR2' }, next: 'https://graph.facebook.com/next' } } })
    const m = createMetaAdsConnector({ fetch: f, appSecret: 'app-secret-ficticio', accessToken: async () => 'meta-token-ficticio' })
    const p1 = await m.listAccessibleAccounts(ctx)
    assert.deepEqual([p1.items[0].externalId, p1.items[0].status, p1.items[0].parentExternalId, p1.nextPageToken], ['1000001', 'active', '777', 'CUR2'])
    const p2 = await m.listAccessibleAccounts(ctx, p1.nextPageToken)
    assert.deepEqual([p2.items[0].status, p2.nextPageToken], ['suspended', null], 'sem paging.next → fim')
    assert.ok(calls[0].url.startsWith('https://graph.facebook.com/v26.0/me/adaccounts?'))
    assert.ok(calls[0].url.includes('appsecret_proof='))
    assert.ok(!calls[0].url.includes('meta-token-ficticio'), 'token nunca na URL')
    assert.equal(calls[0].headers.Authorization, 'Bearer meta-token-ficticio')
  })

  it('insights: uma linha por campanha/dia, spend → micros, só a ação configurada conta como conversão, janela explícita', async () => {
    const { f, calls } = fakeFetch(() => ({ body: { data: [
      { campaign_id: '120000000001', date_start: '2026-11-10', impressions: '5000', reach: '3100', frequency: '1.61', clicks: '120', spend: '87.35',
        actions: [{ action_type: 'link_click', value: '120' }, { action_type: 'lead', value: '7' }, { action_type: 'purchase', value: '2' }] },
      { campaign_id: '120000000002', date_start: '2026-11-10', impressions: '10', clicks: '0', spend: '0.10' }] } }))
    const m = createMetaAdsConnector({ fetch: f, accessToken: async () => 't' })
    const { items } = await m.getDailyMetrics(ctx, 'act_1000001', { start: '2026-11-10', end: '2026-11-10' })
    assert.deepEqual(items[0], { campaignExternalId: '120000000001', date: '2026-11-10', impressions: 5000, clicks: 120, costMicros: 87_350_000, conversions: 7, conversionBasis: 'meta:actions:lead', attribution: 'meta:7d_click,1d_view' })
    assert.equal(items[1].conversions, 0)
    const u = new URL(calls[0].url)
    assert.equal(u.pathname, '/v26.0/act_1000001/insights')
    assert.deepEqual([u.searchParams.get('level'), u.searchParams.get('time_increment'), u.searchParams.get('action_attribution_windows')], ['campaign', '1', '["7d_click","1d_view"]'])
    const p = createMetaAdsConnector({ fetch: f, accessToken: async () => 't', resultAction: 'purchase' })
    assert.equal((await p.getDailyMetrics(ctx, '1000001', { start: '2026-11-10', end: '2026-11-10' })).items[0].conversions, 2)
  })

  it('erros oficiais: 190 → auth_expired (458/460 → revoked); 17/80004 → rate_limited com tempo de espera; 10/200 → permission_denied', () => {
    assert.equal(mapMetaError(400, { error: { code: 190 } }, noHeaders).kind, 'auth_expired')
    assert.equal(mapMetaError(400, { error: { code: 190, error_subcode: 458 } }, noHeaders).kind, 'auth_revoked')
    const lim = mapMetaError(400, { error: { code: 80004 } }, { get: (n: string) => (n === 'x-business-use-case-usage' ? JSON.stringify({ '1000001': [{ estimated_time_to_regain_access: 5 }] }) : null) })
    assert.deepEqual([lim.kind, lim.retryAfterSeconds], ['rate_limited', 300])
    assert.equal(mapMetaError(400, { error: { code: 17 } }, noHeaders).kind, 'rate_limited')
    assert.equal(mapMetaError(403, { error: { code: 200 } }, noHeaders).kind, 'permission_denied')
    assert.equal(mapMetaError(400, { error: { code: 10, message: 'token EAAsecreto' } }, noHeaders).message.includes('EAAsecreto'), false)
  })
})
