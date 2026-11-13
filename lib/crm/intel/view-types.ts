/**
 * Tipos do payload entregue à interface (/api/crm/intel). Só dados de exibição: nenhum token, nenhuma referência de
 * credencial, nenhum ID de cliente financeiro. Importável pelo navegador (sem dependências de servidor).
 */
import type { IntelPlatform, ExternalAccountStatus } from './connectors/contracts'
import type { MetricValue } from './metrics'
import type { AssociationStatus, ClientKind, ConnectionStatus } from './model'
import type { PeriodPreset } from './dates'

export type IntelArea = 'prospeccao' | 'agencia' | 'cliente' | 'conexoes'
export const INTEL_AREAS: readonly IntelArea[] = ['prospeccao', 'agencia', 'cliente', 'conexoes']
export type PlatformFilter = 'all' | 'google_ads' | 'meta_ads'
export type CampaignStatusFilter = 'all' | 'active' | 'paused'

export type IntelFilters = {
  area: IntelArea
  period: PeriodPreset
  platform: PlatformFilter
  status: CampaignStatusFilter
  /** Visão geral: 'all' ou um cliente; visão individual: o cliente selecionado. */
  client: string
  campaign: string
}

export type ViewMeta = {
  /** true somente no modo de demonstração (dados fictícios). */
  simulated: boolean
  /** demo = dados fictícios em memória; real = clientes e contas reais persistidos no banco do CRM. */
  mode: 'demo' | 'real'
  /** Modo real: existe ao menos uma importação concluída de fonte autorizada para os dados exibidos? */
  hasImportedData: boolean
  /** Modo real: horário da última importação concluída considerada nesta visão (null = nenhuma). */
  lastImportAt: string | null
  dataNotice: string
  generatedAt: string
  reportTimeZone: string
  period: { preset: PeriodPreset; label: string; start: string; end: string; includesToday: boolean }
  previous: { start: string; end: string } | null
  /** Filtros EFETIVOS (normalizados para a área): a interface exibe exatamente estes valores. */
  filters: IntelFilters
  /** Recorte por campanha ativo (situação e/ou busca) e o que ele afeta. */
  campaignScope: { active: boolean; status: CampaignStatusFilter; search: string }
  /** Onde ficam os registros desta Central: memória (demonstração) ou banco do CRM (modo real). */
  storage: 'memory' | 'database'
}

export type AssetState =
  | 'connected' | 'no_connection' | 'no_data' | 'paused' | 'suspended' | 'auth_expired' | 'sync_error' | 'stale'
  | 'pending_validation' | 'no_access' | 'not_found'

export type AssetCard = {
  assetId: string
  platform: IntelPlatform
  externalIdLabel: string
  name: string
  currency: string | null
  timeZone: string | null
  association: AssociationStatus
  accountStatus: ExternalAccountStatus
  connectionStatus: ConnectionStatus | 'none'
  accessPath: 'direct' | 'manager' | null
  state: AssetState
  lastSyncAt: string | null
  lastSuccessAt: string | null
  lastRunStatus: string | null
  alerts: { kind: string; message: string }[]
  note: string
  /** Conexão técnica (existência e situação da autorização), separada do vínculo com o cliente. */
  connectionLabel: string | null
  /** Permissão de leitura da conta na plataforma, pelo que se sabe nesta fase. */
  platformAccess: 'yes' | 'no' | 'unknown'
  /** O vínculo e a conexão autorizam sincronizar este ativo? (regra de sync/eligibility.ts) */
  syncAuthorized: boolean
  syncBlockReason: string | null
  manualSync: { allowed: boolean; reason: string | null; retryAt: string | null }
}

export type CurrencyKpis = {
  currency: string
  costMicros: number
  impressions: number
  clicks: number
  ctr: MetricValue
  cpcMicros: MetricValue
  cpmMicros: MetricValue
  /** Investimento no período anterior de mesmo tamanho (mesma moeda), para tendência. */
  previousCostMicros: number | null
}

export type ConversionKpi = {
  platform: 'google_ads' | 'meta_ads'
  basisLabel: string
  attributionLabel: string
  currency: string
  conversions: number | null
  costPerConversionMicros: MetricValue
}

export type AdsKpis = { hasData: boolean; byCurrency: CurrencyKpis[]; conversions: ConversionKpi[] }

export type TrendSeries = { key: string; label: string; platform: 'google_ads' | 'meta_ads' | 'crm'; currency: string | null; unit: 'micros' | 'count'; values: (number | null)[] }
export type Trend = { days: string[]; series: TrendSeries[] }

export type CampaignRow = {
  key: string
  platform: 'google_ads' | 'meta_ads'
  assetName: string
  name: string
  status: 'active' | 'paused' | 'removed'
  channel: string
  currency: string
  costMicros: number
  impressions: number
  clicks: number
  ctr: MetricValue
  cpcMicros: MetricValue
  conversions: number | null
  costPerConversionMicros: MetricValue
  hasData: boolean
  /** Situação da INTEGRAÇÃO/dados da conta (independente do status publicitário da campanha). */
  dataState: AssetState
}

export type ClientOption = { id: string; name: string; kind: ClientKind }

export type ClientView = {
  meta: ViewMeta
  clients: ClientOption[]
  client: ClientOption & { financeLinked: boolean; state: AssetState | 'no_integration' }
  assets: AssetCard[]
  pendingAssets: AssetCard[]
  kpis: AdsKpis
  trend: Trend
  campaigns: CampaignRow[]
  ga4: { assetId: string; name: string; hasData: boolean; sessions: number; totalUsers: number; engagedSessions: number; keyEvents: number
    engagementRate: MetricValue; sources: { source: string; medium: string; sessions: number }[] }[]
  gtm: { assetId: string; publicId: string; name: string; liveVersionId: string | null; tagCount: number; hasGa4Tag: boolean; hasMetaPixelTag: boolean; fetchedAt: string }[]
}

export type OverviewClientRow = {
  id: string
  name: string
  state: AssetState | 'no_integration'
  platforms: IntelPlatform[]
  byCurrency: CurrencyKpis[]
  conversions: ConversionKpi[]
  activeCampaigns: number
  pausedCampaigns: number
  lastSuccessAt: string | null
  openAlerts: number
}

export type OverviewView = {
  meta: ViewMeta
  clients: ClientOption[]
  monitoredClients: number
  platformTotals: (CurrencyKpis & { platform: 'google_ads' | 'meta_ads' })[]
  distribution: { currency: string; parts: { platform: 'google_ads' | 'meta_ads'; costMicros: number; sharePct: number }[] }[]
  conversions: ConversionKpi[]
  campaigns: { active: number; paused: number }
  trend: Trend
  rows: OverviewClientRow[]
  comparison: { currency: string; items: { clientId: string; name: string; costMicros: number }[] }[]
  /** scope: association/security nunca são ocultados pelos filtros; data segue o filtro de plataforma. */
  alerts: { clientName: string; assetName: string; platform: IntelPlatform; kind: string; message: string; since: string; scope: 'association' | 'security' | 'data' }[]
}

export type ProspectingView = {
  meta: ViewMeta
  assets: AssetCard[]
  kpis: AdsKpis
  funnel: {
    simulated: boolean
    /** Leads/reuniões são atribuídos por CANAL (UTM), não por campanha: com recorte de campanhas, ficam indisponíveis. */
    available: boolean
    scopeNote: string
    leads: number; meetings: number; unattributedLeads: number
    byChannel: { platform: 'google_ads' | 'meta_ads'; currency: string; costMicros: number; leads: number; meetings: number
      cplMicros: MetricValue; costPerMeetingMicros: MetricValue; platformConversions: number | null }[]
  }
  trend: Trend
  campaigns: CampaignRow[]
}

export type ConnectionRow = {
  clientId: string
  clientName: string
  platform: IntelPlatform
  assetName: string
  externalIdLabel: string
  association: AssociationStatus
  connectionLabel: string | null
  authStatus: ConnectionStatus | 'none'
  accessPath: 'direct' | 'manager' | null
  lastVerifiedAt: string | null
  lastSyncAt: string | null
  lastRunStatus: string | null
  lastError: string | null
  plannedAction: string
  platformAccess: 'yes' | 'no' | 'unknown'
  syncAuthorized: boolean
  syncBlockReason: string | null
}

export type ConnectionsView = {
  meta: ViewMeta
  storageNotice: string
  /** Inclui o cliente interno da agência (as conexões dele também são administradas aqui). */
  clients: ClientOption[]
  rows: ConnectionRow[]
  connections: { id: string; label: string; provider: 'google' | 'meta'; authKind: string; status: ConnectionStatus; lastVerifiedAt: string | null; scopes: readonly string[] }[]
  recentRuns: { assetName: string; platform: IntelPlatform; kind: string; trigger: string; status: string; attempts: number; rows: number; startedAt: string; error: string | null }[]
}

export type IntelPayload =
  | { area: 'prospeccao'; view: ProspectingView }
  | { area: 'agencia'; view: OverviewView }
  | { area: 'cliente'; view: ClientView }
  | { area: 'conexoes'; view: ConnectionsView }
