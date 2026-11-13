import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { handleIntelAdmin, resetIntelRateWindow, type IntelRequest } from './admin-request'
import { buildDemoSnapshot } from './demo/snapshot'
import { isIntelEnabled } from './feature'

const NOW = new Date('2026-11-13T15:00:00Z')
const base: IntelRequest = { method: 'GET', vercelEnv: 'preview', intelEnabled: 'true', sessionValid: true, originAllowed: true,
  contentType: 'application/json', actorRef: 'sessao-teste', searchParams: new URLSearchParams() }
let clock = NOW
const deps = () => {
  const snapPromise = buildDemoSnapshot(NOW)
  return { now: () => clock, snapshot: () => snapPromise, log: () => undefined }
}

describe('Central — API administrativa', () => {
  beforeEach(() => { resetIntelRateWindow(); clock = NOW })
  it('flag exclusiva: só MI_ENABLED=true liga; ausente/qualquer outro valor → 404', async () => {
    assert.equal(isIntelEnabled(undefined), false)
    assert.equal(isIntelEnabled('TRUE'), false)
    assert.equal(isIntelEnabled('1'), false)
    for (const flag of [undefined, 'false', 'yes']) assert.equal((await handleIntelAdmin(deps(), { ...base, intelEnabled: flag })).status, 404)
  })
  it('fora dos ambientes do CRM → 404 (Production sem CRM_PRODUCTION_ENABLED, site institucional, local sem ambiente)', async () => {
    assert.equal((await handleIntelAdmin(deps(), { ...base, vercelEnv: 'production' })).status, 404)
    assert.equal((await handleIntelAdmin(deps(), { ...base, vercelEnv: undefined })).status, 404)
    assert.equal((await handleIntelAdmin(deps(), { ...base, vercelEnv: 'production', crmProductionEnabled: 'true' })).status, 200)
  })
  it('usuário não autenticado → 401 e nenhum dado', async () => {
    const r = await handleIntelAdmin(deps(), { ...base, sessionValid: false })
    assert.equal(r.status, 401)
    assert.deepEqual(Object.keys(r.body), ['error'])
  })
  it('GET autenticado devolve área, marcação de dados simulados e nenhum segredo', async () => {
    const r = await handleIntelAdmin(deps(), { ...base, searchParams: new URLSearchParams({ area: 'cliente', client: 'cli_demo_c' }) })
    assert.equal(r.status, 200)
    assert.equal(r.body.simulated, true)
    assert.equal(r.body.area, 'cliente')
    assert.doesNotMatch(JSON.stringify(r.body), /token|secret|credential_ref|vault:/i)
  })
  it('filtro inválido → 400; cliente inexistente → 404', async () => {
    assert.equal((await handleIntelAdmin(deps(), { ...base, searchParams: new URLSearchParams({ platform: 'tiktok' }) })).status, 400)
    assert.equal((await handleIntelAdmin(deps(), { ...base, searchParams: new URLSearchParams({ area: 'cliente', client: 'cli_nao_existe' }) })).status, 404)
  })
  it('POST exige origem do CRM, JSON, corpo pequeno e ação conhecida', async () => {
    const post = (o: Partial<IntelRequest>) => handleIntelAdmin(deps(), { ...base, method: 'POST', rawBody: JSON.stringify({ action: 'simulate_sync', assetId: 'ast_demo_g_a1' }), ...o })
    assert.equal((await post({ originAllowed: false })).status, 403)
    assert.equal((await post({ contentType: 'text/plain' })).status, 415)
    assert.equal((await post({ rawBody: 'x'.repeat(3000) })).status, 413)
    assert.equal((await post({ rawBody: '{nope' })).status, 400)
    assert.equal((await post({ rawBody: JSON.stringify({ action: 'publish_campaign', assetId: 'ast_demo_g_a1' }) })).status, 400)
    assert.equal((await post({ rawBody: JSON.stringify({ action: 'simulate_sync', assetId: '../etc' }) })).status, 400)
    assert.equal((await post({ rawBody: JSON.stringify({ action: 'simulate_sync', assetId: 'ast_demo_ga4_c' }) })).status, 409) // sem conexão
    assert.equal((await post({ sessionValid: false })).status, 401)
  })
  it('atualização manual simulada: idempotente e com intervalo mínimo por conta (sem disparos repetidos)', async () => {
    const d = deps()
    const body = JSON.stringify({ action: 'simulate_sync', assetId: 'ast_demo_g_a1' })
    const first = await handleIntelAdmin(d, { ...base, method: 'POST', rawBody: body })
    assert.equal(first.status, 200)
    const run = first.body.run as { status: string; inserted: number; updated: number; unchanged: number }
    assert.equal(run.status, 'succeeded')
    assert.equal(run.inserted + run.updated, 0, 'a revisão de 7 dias não duplica o que já existe')
    const again = await handleIntelAdmin(d, { ...base, method: 'POST', rawBody: body })
    assert.equal(again.status, 429)
    clock = new Date(NOW.getTime() + 16 * 60_000)
    assert.equal((await handleIntelAdmin(d, { ...base, method: 'POST', rawBody: body })).status, 200)
  })
})
