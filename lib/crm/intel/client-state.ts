/**
 * Estado de requisição da interface (puro, testável). Garante que, ao trocar de cliente/área/filtro, NENHUMA resposta
 * atrasada de um pedido anterior seja exibida: cada pedido tem uma chave e só a resposta da chave ATUAL é aceita.
 * Ao trocar de cliente, os dados anteriores são descartados imediatamente (nada do cliente anterior fica na tela).
 */
import { normalizeForArea } from './filters'
import type { IntelArea, IntelFilters } from './view-types'

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
