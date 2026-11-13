import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acceptFailure, acceptResponse, beginRequest, initialState, requestKey } from './client-state'
import type { IntelFilters } from './view-types'

const f = (o: Partial<IntelFilters>): IntelFilters => ({ area: 'cliente', period: '30d', platform: 'all', status: 'all', client: 'cli_demo_a', campaign: '', ...o })

describe('Central — estado da interface na troca de cliente', () => {
  it('trocar de cliente apaga imediatamente os dados do cliente anterior', () => {
    let s = initialState<{ owner: string }>()
    s = beginRequest(s, f({}))
    s = acceptResponse(s, requestKey(f({})), { owner: 'A' })
    assert.equal(s.data?.owner, 'A')
    s = beginRequest(s, f({ client: 'cli_demo_b' }))
    assert.equal(s.data, null, 'nada do cliente A fica na tela enquanto B carrega')
    assert.equal(s.status, 'loading')
  })
  it('resposta atrasada de outro cliente é ignorada', () => {
    let s = beginRequest(initialState<{ owner: string }>(), f({}))
    const keyA = requestKey(f({}))
    s = beginRequest(s, f({ client: 'cli_demo_b' }))
    s = acceptResponse(s, keyA, { owner: 'A' }) // chegou depois da troca
    assert.equal(s.data, null)
    assert.equal(s.status, 'loading')
    s = acceptResponse(s, requestKey(f({ client: 'cli_demo_b' })), { owner: 'B' })
    assert.equal(s.data?.owner, 'B')
    assert.equal(acceptFailure(s, keyA, 'error', 'X'), s, 'falha antiga também é ignorada')
  })
  it('mudar só o período mantém os dados do mesmo cliente enquanto carrega', () => {
    let s = acceptResponse(beginRequest(initialState<{ owner: string }>(), f({})), requestKey(f({})), { owner: 'A' })
    s = beginRequest(s, f({ period: '7d' }))
    assert.equal(s.data?.owner, 'A')
  })
  it('sessão expirada descarta os dados', () => {
    let s = acceptResponse(beginRequest(initialState<{ owner: string }>(), f({})), requestKey(f({})), { owner: 'A' })
    s = beginRequest(s, f({ period: '7d' }))
    s = acceptFailure(s, requestKey(f({ period: '7d' })), 'unauthorized', 'UNAUTHORIZED')
    assert.equal(s.data, null)
  })
})

import { chooseClient, effectiveFilters, navigateArea, omitArchivedClient, prefsFromFilters, resolveFilters } from './client-state'

describe('M5 — política de filtros na navegação entre áreas', () => {
  const EXT = ['cli_demo_a', 'cli_demo_b', 'cli_demo_c', 'cli_demo_d']
  const ALL = ['cli_demo_cassiellos', ...EXT]
  const start = prefsFromFilters({ area: 'agencia', period: '7d', platform: 'meta_ads', status: 'paused', client: 'all', campaign: '' })
  it('período e plataforma preservados; situação preservada onde se aplica e neutra em Conexões', () => {
    const conn = effectiveFilters(navigateArea(start, 'conexoes'), EXT, ALL)
    assert.deepEqual([conn.period, conn.platform, conn.status, conn.campaign], ['7d', 'meta_ads', 'all', ''])
    const back = effectiveFilters(navigateArea(navigateArea(start, 'conexoes'), 'agencia'), EXT, ALL)
    assert.equal(back.status, 'paused', 'volta a valer ao retornar')
    const p = effectiveFilters(navigateArea(start, 'prospeccao'), EXT, ALL)
    assert.deepEqual([p.status, p.client, p.platform], ['paused', 'all', 'meta_ads'])
  })
  it('cliente só muda quando a área exige; busca limpa ao trocar de área ou cliente', () => {
    let p = navigateArea(start, 'cliente')
    assert.equal(effectiveFilters(p, EXT, ALL).client, 'cli_demo_a', 'Cliente exige um cliente: o primeiro')
    p = chooseClient(p, 'cli_demo_c', EXT)
    p = { ...p, campaign: 'leads' }
    assert.equal(effectiveFilters(p, EXT, ALL).campaign, 'leads')
    const ag = effectiveFilters(navigateArea(p, 'agencia'), EXT, ALL)
    assert.deepEqual([ag.client, ag.campaign], ['cli_demo_c', ''], 'contexto do cliente mantido; busca limpa')
    const pr = navigateArea(navigateArea(p, 'prospeccao'), 'cliente')
    assert.equal(effectiveFilters(pr, EXT, ALL).client, 'cli_demo_c', 'retorna ao último cliente')
    assert.equal(chooseClient(p, 'cli_demo_a', EXT).campaign, '')
  })
  it('valores inválidos para a área nunca ficam escondidos', () => {
    const agencyInOverview = effectiveFilters({ ...start, client: 'cli_demo_cassiellos' }, EXT, ALL)
    assert.equal(agencyInOverview.client, 'all')
    const agencyInConn = effectiveFilters({ ...start, area: 'conexoes', client: 'cli_demo_cassiellos' }, EXT, ALL)
    assert.equal(agencyInConn.client, 'cli_demo_cassiellos')
    const unknown = effectiveFilters({ ...start, area: 'cliente', client: 'cli_x', lastClient: null }, EXT, ALL)
    assert.equal(unknown.client, 'cli_demo_a')
  })
})

describe('Etapa C — D1/D2: exclusão de seleção arquivada e cliente vazio', () => {
  it('D2: área Cliente sem clientes transforma client=all em seleção vazia', () => {
    const p = prefsFromFilters(f({ client: 'all' }))
    assert.equal(resolveFilters(p, { clients: [], connClients: [] }).client, '')
  })
  it('D1: remove cliente arquivado de todas as listas sem mexer nos demais', () => {
    const current = {
      clients: [{ id: 'a', name: 'Cliente A', kind: 'client' as const }, { id: 'b', name: 'Cliente B', kind: 'client' as const }],
      connClients: [{ id: 'a', name: 'Cliente A', kind: 'client' as const }, { id: 'b', name: 'Cliente B', kind: 'client' as const }],
    }
    const next = omitArchivedClient(current, 'a')
    assert.deepEqual(next.clients.map(c => c.id), ['b'])
    assert.deepEqual(next.connClients.map(c => c.id), ['b'])
    assert.equal(omitArchivedClient(next, 'a'), next, 'sem mudanças a referência permanece estável')
    const p = prefsFromFilters(f({ client: 'a' }))
    const effective = resolveFilters(p, next)
    assert.equal(effective.client, 'b', 'seleciona o cliente ativo restante')
  })
})
