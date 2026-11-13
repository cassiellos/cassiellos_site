/**
 * Política de filtros por área (compartilhada entre navegador e servidor — sem dependências de servidor).
 *
 * - Período: vale em todas as áreas e é preservado na navegação.
 * - Plataforma: vale em todas as áreas (Conexões filtra só as contas de anúncios; GA4/GTM aparecem com "Todas").
 * - Situação das campanhas: Prospecção, Visão geral e Cliente. Em Conexões não se aplica → enviada como "all".
 * - Busca de campanha: Prospecção e Cliente. Limpa ao trocar de área ou de cliente (nomes são do contexto anterior).
 * - Cliente: Visão geral ("todos" ou um cliente), Cliente (obrigatório), Conexões ("todos", um cliente ou a agência).
 *   Na Prospecção o contexto é sempre a agência ("all").
 * A API aplica a mesma normalização e devolve os filtros EFETIVOS em meta.filters; a interface exibe esses valores.
 */
import type { IntelArea, IntelFilters } from './view-types'

export const STATUS_AREAS: readonly IntelArea[] = ['prospeccao', 'agencia', 'cliente']
export const SEARCH_AREAS: readonly IntelArea[] = ['prospeccao', 'cliente']
export const CLIENT_AREAS: readonly IntelArea[] = ['agencia', 'cliente', 'conexoes']

export function normalizeForArea(f: IntelFilters): IntelFilters {
  return {
    ...f,
    status: STATUS_AREAS.includes(f.area) ? f.status : 'all',
    campaign: SEARCH_AREAS.includes(f.area) ? f.campaign : '',
    client: f.area === 'prospeccao' ? 'all' : f.client,
  }
}
