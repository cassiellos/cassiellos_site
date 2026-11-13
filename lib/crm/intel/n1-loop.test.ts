/**
 * M09 — regressão do N1 (laço de requisições na Central de Inteligência).
 *
 * O N1 era: cada resposta trocava a REFERÊNCIA da lista de clientes (mesmo conteúdo) → o objeto de filtros era recriado →
 * o efeito de busca rodava de novo, sem parar, em Visão geral, Cliente e Conexões (as respostas que trazem a lista).
 * Aqui a sessão da interface é simulada com as MESMAS funções puras que o componente usa (client-state.ts) e com o
 * handler REAL da API (dados simulados); cada resposta passa por JSON.parse(JSON.stringify()) — como no navegador, em que
 * toda resposta chega com arrays/objetos NOVOS. O teste de navegador (scripts/intel-n1-e2e.mjs) confere o mesmo no DOM real.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { handleIntelAdmin, resetIntelRateWindow, type IntelRequest } from './admin-request'
import {
  EMPTY_CLIENT_LISTS, absorbClientLists, adoptEffectiveFilters, chooseClient, navigateArea, prefsFromFilters, requestKey, resolveFilters, sameClientList,
  type ClientLists, type FilterPrefs,
} from './client-state'
import { buildDemoSnapshot } from './demo/snapshot'
import type { ClientOption, IntelArea, IntelFilters } from './view-types'

const NOW = new Date('2026-11-13T15:00:00Z')
const REQ: IntelRequest = { method: 'GET', vercelEnv: 'preview', intelEnabled: 'true', sessionValid: true, originAllowed: true, contentType: null, actorRef: 'teste' }
const snapshot = buildDemoSnapshot(NOW)
const deps = { now: () => NOW, snapshot: () => snapshot, log: () => undefined }

/** Reproduz o ciclo do componente: filtros efetivos → (se a chave mudou) busca → absorve resposta → adota cliente efetivo. */
class Session {
  prefs: FilterPrefs
  lists: ClientLists = EMPTY_CLIENT_LISTS
  calls: string[] = []
  listsRefChanges = 0
  private lastKey: string | null = null
  constructor(initial: IntelFilters) { this.prefs = prefsFromFilters(initial) }
  get filters() { return resolveFilters(this.prefs, this.lists) }
  /** Roda até estabilizar (como o React: só busca quando a CHAVE dos filtros efetivos muda). Devolve o nº de buscas feitas. */
  async settle(): Promise<number> {
    let made = 0
    for (let guard = 0; guard < 25; guard++) {
      const filters = this.filters
      const key = requestKey(filters)
      if (key === this.lastKey) return made
      this.lastKey = key
      this.calls.push(key); made++
      const params = new URLSearchParams({ area: filters.area, period: filters.period, platform: filters.platform, status: filters.status, campaign: filters.campaign })
      if (filters.client) params.set('client', filters.client)
      const res = await handleIntelAdmin(deps, { ...REQ, searchParams: params })
      assert.equal(res.status, 200, 'GET ' + params.toString())
      const body = JSON.parse(JSON.stringify(res.body)) as { area: IntelArea; view: { clients?: ClientOption[]; meta: { filters: IntelFilters } } }
      const next = absorbClientLists(this.lists, body.area, body.view.clients)
      if (next !== this.lists) this.listsRefChanges++
      this.lists = next
      const eff = body.view.meta.filters
      if (requestKey(eff) !== key && eff.client !== filters.client) this.prefs = adoptEffectiveFilters(this.prefs, eff)
    }
    throw new Error('não estabilizou: laço de requisições (N1) — chamadas: ' + this.calls.length)
  }
  go(area: IntelArea) { this.prefs = navigateArea(this.prefs, area) }
}

const start = (o: Partial<IntelFilters> = {}): IntelFilters => ({ area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '', ...o })

describe('N1 — identidade estável das listas de clientes', () => {
  const list: ClientOption[] = [{ id: 'cli_demo_a', name: 'A', kind: 'client' }, { id: 'cli_demo_b', name: 'B', kind: 'client' }]
  const fresh = () => JSON.parse(JSON.stringify(list)) as ClientOption[]
  it('mesmo conteúdo com novas referências NÃO troca o estado (mesma referência devolvida)', () => {
    const first = absorbClientLists(EMPTY_CLIENT_LISTS, 'agencia', fresh())
    assert.notEqual(first, EMPTY_CLIENT_LISTS)
    for (let i = 0; i < 5; i++) assert.equal(absorbClientLists(first, 'agencia', fresh()), first)
    const conn = absorbClientLists(first, 'conexoes', [{ id: 'cli_demo_cassiellos', name: 'Cassiellos', kind: 'agency' }, ...fresh()])
    assert.notEqual(conn, first)
    assert.equal(absorbClientLists(conn, 'conexoes', [{ id: 'cli_demo_cassiellos', name: 'Cassiellos', kind: 'agency' }, ...fresh()]), conn)
    assert.equal(absorbClientLists(conn, 'prospeccao', undefined), conn, 'Prospecção não traz lista: nada muda')
  })
  it('conteúdo diferente (id, nome, tipo, ordem ou tamanho) troca o estado', () => {
    const base = absorbClientLists(EMPTY_CLIENT_LISTS, 'agencia', fresh())
    assert.notEqual(absorbClientLists(base, 'agencia', [list[0]]), base)
    assert.notEqual(absorbClientLists(base, 'agencia', [list[1], list[0]]), base)
    assert.notEqual(absorbClientLists(base, 'agencia', [{ ...list[0], name: 'A2' }, list[1]]), base)
    assert.equal(sameClientList([{ id: 'x', name: 'n', kind: 'client' }], [{ id: 'x', name: 'n', kind: 'agency' }]), false)
  })
  it('a chave dos filtros efetivos não muda quando só a referência da lista muda', () => {
    const prefs = prefsFromFilters(start({ area: 'cliente', client: 'cli_demo_a' }))
    const a = absorbClientLists(EMPTY_CLIENT_LISTS, 'agencia', fresh())
    const b = { ...a, clients: fresh() } // outra referência, mesmo conteúdo
    assert.notEqual(resolveFilters(prefs, a), resolveFilters(prefs, b))
    assert.equal(requestKey(resolveFilters(prefs, a)), requestKey(resolveFilters(prefs, b)))
  })
  it('adoptEffectiveFilters devolve a mesma referência quando não há o que adotar', () => {
    const p = prefsFromFilters(start())
    assert.equal(adoptEffectiveFilters(p, start()), p)
    assert.notEqual(adoptEffectiveFilters(prefsFromFilters(start({ area: 'cliente', client: '' })), start({ area: 'cliente', client: 'cli_demo_a' })).client, '')
  })
})

describe('N1 — estado inicial de cada área: estabiliza sem laço', () => {
  beforeEach(() => resetIntelRateWindow())
  const cases: [string, IntelFilters, number][] = [
    ['Prospecção', start({ area: 'prospeccao' }), 1],
    ['Visão geral', start({ area: 'agencia' }), 1],
    ['Cliente com cliente na URL', start({ area: 'cliente', client: 'cli_demo_a' }), 1],
    ['Cliente sem cliente na URL (cliente padrão: no máximo 1 normalização legítima)', start({ area: 'cliente', client: '' }), 2],
    ['Conexões', start({ area: 'conexoes' }), 1],
  ]
  for (const [label, filters, max] of cases) {
    it(label + ': ≤ ' + max + ' busca(s) e estável após a estabilização', async () => {
      const s = new Session(filters)
      const made = await s.settle()
      assert.ok(made >= 1 && made <= max, label + ': ' + made + ' buscas — ' + s.calls.join(' ; '))
      assert.equal(await s.settle(), 0, 'nenhuma busca nova sem interação')
      // Respostas repetidas (ex.: o React reexecutando render) não recriam a lista:
      for (let i = 0; i < 20; i++) assert.equal(await s.settle(), 0)
      assert.ok(s.listsRefChanges <= 2, 'listas mudam de referência só quando o conteúdo muda')
    })
  }
})

describe('N1 — interações geram só as requisições necessárias', () => {
  beforeEach(() => resetIntelRateWindow())
  it('período, plataforma, situação, troca de cliente e de área: 1 busca por mudança efetiva', async () => {
    const s = new Session(start())
    assert.equal(await s.settle(), 1)
    s.prefs = { ...s.prefs, period: '7d' }; assert.equal(await s.settle(), 1, 'período')
    s.prefs = { ...s.prefs, platform: 'meta_ads' }; assert.equal(await s.settle(), 1, 'plataforma')
    s.prefs = { ...s.prefs, status: 'active' }; assert.equal(await s.settle(), 1, 'Ativas')
    s.prefs = { ...s.prefs, status: 'paused' }; assert.equal(await s.settle(), 1, 'Pausadas')
    s.prefs = { ...s.prefs, status: 'paused' }; assert.equal(await s.settle(), 0, 'mesmo valor: nenhuma busca')
    s.go('cliente'); assert.ok(await s.settle() === 1, 'Cliente (cliente padrão já conhecido da lista)')
    assert.equal(s.filters.status, 'paused', 'situação preservada (M5)')
    s.prefs = chooseClient(s.prefs, 'cli_demo_c', s.lists.clients.map(c => c.id)); assert.equal(await s.settle(), 1, 'troca de cliente')
    s.prefs = { ...s.prefs, campaign: 'leads' }; assert.equal(await s.settle(), 1, 'busca de campanha')
    s.go('conexoes'); assert.equal(await s.settle(), 1, 'Conexões')
    assert.deepEqual([s.filters.status, s.filters.campaign], ['all', ''], 'Conexões: situação neutra e busca limpa (M5)')
    s.go('agencia'); assert.equal(await s.settle(), 1, 'volta à Visão geral')
    assert.deepEqual([s.filters.status, s.filters.period, s.filters.platform], ['paused', '7d', 'meta_ads'], 'contexto anterior preservado')
    s.go('prospeccao'); assert.equal(await s.settle(), 1, 'Prospecção')
    s.go('agencia'); assert.equal(await s.settle(), 1)
    assert.equal(await s.settle(), 0)
    assert.equal(new Set(s.calls.slice(-2)).size, 2)
  })
  it('"Atualizar/Recarregar" é uma busca explícita adicional (contador de refresh), não um laço', async () => {
    const s = new Session(start())
    await s.settle()
    const before = s.calls.length
    // o componente refaz a busca ao mudar `refresh`; as chaves dos filtros seguem iguais e a lista não muda de referência
    const lists = s.lists
    const res = await handleIntelAdmin(deps, { ...REQ, searchParams: new URLSearchParams({ area: 'agencia' }) })
    const body = JSON.parse(JSON.stringify(res.body)) as { area: IntelArea; view: { clients: ClientOption[] } }
    assert.equal(absorbClientLists(lists, body.area, body.view.clients), lists)
    assert.equal(s.calls.length, before)
    assert.equal(await s.settle(), 0)
  })
})
