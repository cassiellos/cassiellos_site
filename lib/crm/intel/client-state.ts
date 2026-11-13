/**
 * Estado de requisição da interface (puro, testável). Garante que, ao trocar de cliente/área/filtro, NENHUMA resposta
 * atrasada de um pedido anterior seja exibida: cada pedido tem uma chave e só a resposta da chave ATUAL é aceita.
 * Ao trocar de cliente, os dados anteriores são descartados imediatamente (nada do cliente anterior fica na tela).
 */
import type { IntelFilters } from './view-types'

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
