/**
 * Estado de requisição da interface (puro, testável). Garante que, ao trocar de cliente/área/filtro, NENHUMA resposta
 * atrasada de um pedido anterior seja exibida: cada pedido tem uma chave e só a resposta da chave ATUAL é aceita.
 * Ao trocar de cliente, os dados anteriores são descartados imediatamente (nada do cliente anterior fica na tela).
 */
import { normalizeForArea } from './filters'
import type { ClientOption, IntelArea, IntelFilters } from './view-types'

export type FetchStatus = 'loading' | 'ready' | 'error' | 'unauthorized'
export type FetchState<T> = { key: string; scope: string; status: FetchStatus; data: T | null; error: string | null }

export function requestKey(f: IntelFilters): string {
  return [f.area, f.client, f.period, f.platform, f.status, f.campaign].join('|')
}
/** Escopo de dados: mudar o escopo (área ou cliente) apaga a tela; mudar só filtros mantém os dados enquanto carrega. */
export function dataScope(f: IntelFilters): string { return f.area + '|' + f.client }

export function initialState<T>(): FetchState<T> { return { key: '', scope: '', status: 'loading', data: null, error: null } }

export function beginRequest<T>(prev: FetchState<T>, f: IntelFilters): FetchState<T> {
  const scope = dataScope(f)
  return { key: requestKey(f), scope, status: 'loading', data: prev.scope === scope ? prev.data : null, error: null }
}

export function acceptResponse<T>(state: FetchState<T>, key: string, data: T): FetchState<T> {
  if (state.key !== key) return state // resposta antiga: ignorada
  return { ...state, status: 'ready', data, error: null }
}

export function acceptFailure<T>(state: FetchState<T>, key: string, status: 'error' | 'unauthorized', error: string): FetchState<T> {
  if (state.key !== key) return state
  return { ...state, status, error, data: status === 'unauthorized' ? null : state.data }
}

/* ---------------- M5: navegação entre áreas (política previsível e testável) ---------------- */

/**
 * Preferências do usuário (o que ele escolheu) × filtros EFETIVOS (o que vale na área atual). A tela, a URL e a API
 * usam SEMPRE os efetivos: nunca há um filtro visível diferente do aplicado.
 * - período e plataforma: preservados;
 * - situação das campanhas: preservada entre Prospecção, Visão geral e Cliente; em Conexões não se aplica (efetivo
 *   "all") e a escolha volta ao retornar a uma área que a suporta;
 * - busca de campanha: limpa ao trocar de área ou de cliente;
 * - cliente: só muda quando a área exige outro contexto (Cliente exige um cliente; Prospecção é sempre a agência).
 */
export type FilterPrefs = IntelFilters & { lastClient: string | null }

export function prefsFromFilters(f: IntelFilters): FilterPrefs {
  return { ...f, lastClient: f.area === 'cliente' && f.client && f.client !== 'all' ? f.client : null }
}

/** Filtros efetivos da área atual. `externalClients`: clientes (não agência) disponíveis, na ordem de exibição. */
export function effectiveFilters(p: FilterPrefs, externalClients: readonly string[], allClients: readonly string[] = externalClients): IntelFilters {
  const base: IntelFilters = { area: p.area, period: p.period, platform: p.platform, status: p.status, campaign: p.campaign, client: p.client }
  if (p.area === 'cliente') {
    const pick = [p.client, p.lastClient].find(c => c && externalClients.includes(c)) ?? externalClients[0] ?? ''
    base.client = pick
  } else if (p.area === 'agencia') {
    base.client = externalClients.includes(p.client) ? p.client : 'all'
  } else if (p.area === 'conexoes') {
    base.client = allClients.includes(p.client) ? p.client : 'all'
  }
  return normalizeForArea(base)
}

export function navigateArea(p: FilterPrefs, area: IntelArea): FilterPrefs {
  return { ...p, area, campaign: '' }
}

export function chooseClient(p: FilterPrefs, client: string, externalClients: readonly string[]): FilterPrefs {
  return { ...p, client, campaign: '', lastClient: externalClients.includes(client) ? client : p.lastClient }
}

/* ---------------- M09 (N1): identidade estável — sem laço de requisições ----------------
 * Causa do N1 (provada por instrumentação local): cada resposta chamava `setClients(novoArray)`; a lista tinha o MESMO
 * conteúdo, mas outra identidade; isso recriava os arrays derivados e o objeto de filtros, e o efeito que busca na API
 * (dependente da IDENTIDADE do objeto) rodava de novo — indefinidamente, em Visão geral, Cliente e Conexões (as áreas
 * cujas respostas trazem a lista de clientes). Prospecção não traz a lista e por isso não entrava no laço.
 * Regra: o que dispara uma busca é a IDENTIDADE SEMÂNTICA dos filtros efetivos (`requestKey`), e as listas de clientes só
 * mudam de referência quando o CONTEÚDO muda. As funções abaixo são puras e cobertas por testes.
 */

/** Listas de clientes conhecidas pela interface: `clients` = clientes externos; `connClients` = lista de Conexões (inclui a agência). */
export type ClientLists = { clients: ClientOption[]; connClients: ClientOption[] }
export const EMPTY_CLIENT_LISTS: ClientLists = { clients: [], connClients: [] }

/** Mesmo conteúdo (id, nome e tipo, na mesma ordem), independentemente da identidade dos arrays/objetos. */
export function sameClientList(a: readonly ClientOption[], b: readonly ClientOption[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && c.name === b[i].name && c.kind === b[i].kind)
}

/**
 * Incorpora a lista de clientes de uma resposta. Devolve o MESMO objeto (`prev`) quando nada mudou — o React descarta a
 * atualização e nada é recalculado. `listed` é `undefined` nas áreas cuja resposta não traz a lista (Prospecção).
 */
export function absorbClientLists(prev: ClientLists, area: IntelArea, listed: readonly ClientOption[] | undefined): ClientLists {
  if (!listed) return prev
  if (area === 'conexoes') return sameClientList(prev.connClients, listed) ? prev : { ...prev, connClients: listed.map(c => ({ ...c })) }
  const external = listed.filter(c => c.kind === 'client')
  return sameClientList(prev.clients, external) ? prev : { ...prev, clients: external.map(c => ({ ...c })) }
}

/** Retira imediatamente um cliente arquivado das opções conhecidas, sem deixar seleção fantasma na UI. */
export function omitArchivedClient(prev: ClientLists, id: string): ClientLists {
  const clients = prev.clients.filter(c => c.id !== id)
  const connClients = prev.connClients.filter(c => c.id !== id)
  return clients.length === prev.clients.length && connClients.length === prev.connClients.length
    ? prev : { clients, connClients }
}

/** Filtros efetivos a partir das preferências e das listas conhecidas (antes de conhecer clientes vale o pedido normalizado). */
export function resolveFilters(prefs: FilterPrefs, lists: ClientLists): IntelFilters {
  const externalIds = lists.clients.filter(c => c.kind === 'client').map(c => c.id)
  if (!externalIds.length) return normalizeForArea({ area: prefs.area, period: prefs.period, platform: prefs.platform, status: prefs.status, campaign: prefs.campaign,
    client: prefs.area === 'cliente' && prefs.client === 'all' ? '' : prefs.client })
  const allIds = (lists.connClients.length ? lists.connClients : lists.clients).map(c => c.id)
  return effectiveFilters(prefs, externalIds, allIds)
}

/**
 * A API devolve os filtros EFETIVOS. Se diferirem do pedido, a interface adota o cliente efetivo nas preferências e busca
 * uma única vez mais (normalização). Devolve `p` (mesma referência) quando não há nada a adotar.
 */
export function adoptEffectiveFilters(p: FilterPrefs, eff: IntelFilters): FilterPrefs {
  const client = eff.area === 'prospeccao' ? p.client : eff.client
  const lastClient = eff.area === 'cliente' ? eff.client : p.lastClient
  return client === p.client && lastClient === p.lastClient ? p : { ...p, client, lastClient }
}
