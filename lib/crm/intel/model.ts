/**
 * Central de Inteligência — MODELO DE DOMÍNIO (espelha as tabelas mi_* das migrações 0017/0018).
 *
 * - Cliente MONITORADO ≠ cliente financeiro: `financeClientId` é opcional (ligação a crm.finance_clients, somente leitura).
 * - A Cassiellos é um cliente interno do tipo `agency` (área Prospecção Cassiellos).
 * - Um cliente pode ter N ativos (várias contas Google Ads/Meta Ads, várias propriedades GA4, vários contêineres GTM).
 * - Associação cliente × ativo tem status; SÓ `confirmed` alimenta métricas definitivas.
 */
import type { ExternalAccountStatus, IntelPlatform } from './connectors/contracts'

export type ClientKind = 'agency' | 'client'
export type ClientStatus = 'active' | 'paused' | 'archived'

export type MonitoredClient = {
  id: string
  name: string
  kind: ClientKind
  status: ClientStatus
  /** Vínculo opcional ao cadastro financeiro (crm.finance_clients.id). Nunca exposto à interface além de "vinculado". */
  financeClientId: string | null
  /** Fuso de EXIBIÇÃO dos períodos (as métricas continuam no fuso de cada conta). */
  reportTimeZone: string
}

export type ConnectionProvider = 'google' | 'meta'
export type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'error'

export type Connection = {
  id: string
  provider: ConnectionProvider
  label: string
  authKind: 'oauth_user' | 'system_user'
  status: ConnectionStatus
  scopes: readonly string[]
  lastVerifiedAt: string | null
  lastErrorCode: string | null
}

export type AccessPath = 'direct' | 'manager'

export type Asset = {
  id: string
  platform: IntelPlatform
  /** ID externo normalizado (Google Ads sem hífens; Meta sem "act_"; GA4 só o número; GTM "GTM-XXXX"). */
  externalId: string
  /** Contexto que completa a identidade quando necessário (ex.: conta GTM). '' quando o ID já é global. */
  externalContext: string
  name: string
  currencyCode: string | null
  timeZone: string | null
  accountStatus: ExternalAccountStatus
  /** Caminho de leitura atual (mi_asset_access). null = sem acesso conhecido. */
  connectionId: string | null
  accessPath: AccessPath | null
  loginCustomerId: string | null
}

export type AssociationStatus = 'confirmed' | 'probable' | 'not_found' | 'no_access'
export const ASSOCIATION_LABEL: Record<AssociationStatus, string> = {
  confirmed: 'Confirmado', probable: 'Provável (aguardando validação)', not_found: 'Não encontrado', no_access: 'Sem acesso',
}

export type ClientAsset = {
  clientId: string
  assetId: string
  status: AssociationStatus
  validatedAt: string | null
  note: string
}

/** Regra central de isolamento: só vínculos confirmados alimentam métricas. */
export function feedsMetrics(status: AssociationStatus): boolean {
  return status === 'confirmed'
}

export const PLATFORM_LABEL: Record<IntelPlatform, string> = {
  google_ads: 'Google Ads', meta_ads: 'Meta Ads', ga4: 'Google Analytics 4', gtm: 'Google Tag Manager',
}

/** Normalização da identidade externa (mesma regra dos CHECKs da migração 0017). */
export function normalizeExternalId(platform: IntelPlatform, raw: string): string | null {
  const v = raw.trim()
  switch (platform) {
    case 'google_ads': { const d = v.replace(/-/g, ''); return /^\d{10}$/.test(d) ? d : null }
    case 'meta_ads': { const d = v.replace(/^act_/, ''); return /^\d{5,20}$/.test(d) ? d : null }
    case 'ga4': { const d = v.replace(/^properties\//, ''); return /^\d{5,15}$/.test(d) ? d : null }
    case 'gtm': return /^GTM-[A-Z0-9]{4,12}$/.test(v) ? v : null
  }
}

export function formatExternalId(platform: IntelPlatform, id: string): string {
  if (platform === 'google_ads' && /^\d{10}$/.test(id)) return id.slice(0, 3) + '-' + id.slice(3, 6) + '-' + id.slice(6)
  if (platform === 'meta_ads') return 'act_' + id
  return id
}
