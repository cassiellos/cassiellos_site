/**
 * Central de Inteligência — CONTRATOS DE LEITURA dos conectores (Google Ads, Meta Ads, GA4, GTM).
 *
 * São interfaces SOMENTE DE LEITURA: não existe método para criar, alterar, pausar ou publicar nada. Os adaptadores
 * reais (fase futura) recebem apenas o `ConnectorContext` — nunca um token: a credencial é resolvida no servidor por
 * um cofre (credential-vault.ts) e jamais trafega para o navegador ou para os logs.
 *
 * Observação de segurança: o escopo OAuth do Google Ads (`adwords`) permite operações de escrita. Por isso, além do
 * contrato sem métodos de mutação, todo adaptador real deve passar cada chamada por `assertReadOnlyRequest`
 * (read-only-guard.ts), que só permite serviços e consultas de leitura listados explicitamente.
 */
import type { CivilDate, DateRange } from '../dates'

export type IntelPlatform = 'google_ads' | 'meta_ads' | 'ga4' | 'gtm'
export type AdsPlatformId = 'google_ads' | 'meta_ads'

/** Identifica QUAL conexão (credencial) e qual caminho de acesso usar. Sem segredo algum. */
export type ConnectorContext = {
  connectionId: string
  /** Google Ads via conta de administrador (MCC): ID do gerente, sem hífens. null/ausente = acesso direto. */
  loginCustomerId?: string | null
}

export type Page<T> = { items: T[]; nextPageToken: string | null }

/** Situação da conta na plataforma (não confundir com a situação da autorização). */
export type ExternalAccountStatus = 'active' | 'paused' | 'suspended' | 'closed' | 'unknown'

export type AdAccountInfo = {
  platform: AdsPlatformId
  externalId: string
  name: string
  currencyCode: string
  timeZone: string
  status: ExternalAccountStatus
  /** Conta gerente (MCC) ou portfólio empresarial pelo qual a conta foi vista, quando houver. */
  parentExternalId: string | null
}

export type CampaignStatus = 'active' | 'paused' | 'removed'
export type CampaignInfo = { externalId: string; name: string; status: CampaignStatus; channel: string }

export type DailyAdsRow = {
  campaignExternalId: string
  /** Data civil NO FUSO DA CONTA. */
  date: CivilDate
  impressions: number
  clicks: number
  costMicros: number
  /** null quando a plataforma não informou conversões. */
  conversions: number | null
  /** Definição da conversão (ex.: "google:conversions", "meta:actions:lead"). */
  conversionBasis: string
  /** Modelo/janela de atribuição usado na consulta (ex.: "google:modelo-da-conta", "meta:7d_click,1d_view"). */
  attribution: string
}

export type RateLimitState = {
  /** Operações restantes no ciclo conhecido (null = a plataforma não informa). */
  remaining: number | null
  /** Percentual de uso informado (ex.: X-Business-Use-Case-Usage da Meta). */
  usagePercent: number | null
}

export interface AdsReadConnector {
  readonly platform: AdsPlatformId
  listAccessibleAccounts(ctx: ConnectorContext, pageToken?: string | null): Promise<Page<AdAccountInfo>>
  getAccount(ctx: ConnectorContext, externalId: string): Promise<AdAccountInfo>
  listCampaigns(ctx: ConnectorContext, externalId: string, pageToken?: string | null): Promise<Page<CampaignInfo>>
  getDailyMetrics(ctx: ConnectorContext, externalId: string, range: DateRange, pageToken?: string | null): Promise<Page<DailyAdsRow>>
  rateLimit(): RateLimitState
}

export type Ga4PropertyInfo = { externalId: string; name: string; timeZone: string; currencyCode: string; accountExternalId: string }
export type Ga4DailyRow = {
  date: CivilDate; source: string; medium: string; campaign: string
  sessions: number; totalUsers: number; engagedSessions: number; keyEvents: number
}
export interface Ga4ReadConnector {
  readonly platform: 'ga4'
  listProperties(ctx: ConnectorContext, pageToken?: string | null): Promise<Page<Ga4PropertyInfo>>
  runDailyReport(ctx: ConnectorContext, propertyId: string, range: DateRange, pageToken?: string | null): Promise<Page<Ga4DailyRow>>
  rateLimit(): RateLimitState
}

/** GTM: SOMENTE metadados e diagnóstico. Não é fonte de métricas de campanha. */
export type GtmContainerInfo = { publicId: string; accountExternalId: string; containerExternalId: string; name: string }
export type GtmDiagnostics = {
  publicId: string
  liveVersionId: string | null
  lastPublishedAt: string | null
  tagCount: number
  /** Indícios de configuração (somente leitura): tag do GA4 e tag de Pixel presentes no contêiner publicado. */
  hasGa4Tag: boolean
  hasMetaPixelTag: boolean
}
export interface GtmReadConnector {
  readonly platform: 'gtm'
  listContainers(ctx: ConnectorContext, pageToken?: string | null): Promise<Page<GtmContainerInfo>>
  getDiagnostics(ctx: ConnectorContext, publicId: string): Promise<GtmDiagnostics>
}

/** Erros normalizados — a fila de sincronização decide nova tentativa a partir do `kind`. */
export type ConnectorErrorKind =
  | 'rate_limited'      // 429 / RESOURCE_EXHAUSTED / códigos de limite da Meta → backoff
  | 'transient'         // 5xx, timeout, rede → nova tentativa limitada
  | 'auth_expired'      // refresh token expirado/invalid_grant → para e alerta
  | 'auth_revoked'      // autorização revogada pelo titular → para e alerta
  | 'permission_denied' // sem acesso à conta → para e alerta
  | 'not_found'
  | 'invalid_request'

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind
  readonly retryAfterSeconds: number | null
  constructor(kind: ConnectorErrorKind, message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ConnectorError'
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export const RETRYABLE_KINDS: ReadonlySet<ConnectorErrorKind> = new Set(['rate_limited', 'transient'])
