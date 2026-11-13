/**
 * DADOS SIMULADOS da Central de Inteligência (demonstração da fundação).
 *
 * Tudo aqui é FICTÍCIO: nomes "Cliente Exemplo …"/"Cassiellos Demo", IDs externos de demonstração (prefixo 9…,
 * GTM-DEMO…) e valores gerados deterministicamente. Não há relação com clientes, contas, leads ou valores reais,
 * nenhum token e nenhum identificador secreto. As datas são relativas ao "hoje" de quem consulta.
 */
import { addDays, type CivilDate } from '../dates'
import type { MockAdAccountSpec, MockCampaignSpec, MockFault, MockGa4Spec, MockGtmSpec } from '../connectors/mock'
import type { Asset, ClientAsset, Connection, MonitoredClient } from '../model'

export const DEMO_REPORT_TZ = 'America/Sao_Paulo'
export const DEMO_HISTORY_DAYS = 120

export type DemoDataset = {
  clients: MonitoredClient[]
  connections: Connection[]
  assets: Asset[]
  links: ClientAsset[]
  adAccounts: MockAdAccountSpec[]
  ga4: MockGa4Spec[]
  gtm: MockGtmSpec[]
  /** Quantos dias atrás foi a última sincronização bem-sucedida (dados desatualizados). */
  staleDays: Record<string, number>
  /** Falhas programadas na execução diária mais recente. */
  latestRunFaults: Record<string, MockFault>
}

const camp = (today: CivilDate, id: string, name: string, channel: string, o: Partial<MockCampaignSpec> & { from: number; until?: number | null },
  base: Pick<MockCampaignSpec, 'dailyImpressions' | 'ctrPct' | 'cpcMicros' | 'conversionRate'>): MockCampaignSpec => ({
  externalId: id, name, channel, activeFrom: addDays(today, o.from), activeUntil: o.until === undefined || o.until === null ? null : addDays(today, o.until),
  gaps: o.gaps, ...base,
})

export function buildDemoDataset(today: CivilDate, nowIso: string): DemoDataset {
  const ago = (h: number) => new Date(Date.parse(nowIso) - h * 3_600_000).toISOString()
  const clients: MonitoredClient[] = [
    { id: 'cli_demo_cassiellos', name: 'Cassiellos Demo', kind: 'agency', status: 'active', financeClientId: null, reportTimeZone: DEMO_REPORT_TZ },
    { id: 'cli_demo_a', name: 'Cliente Exemplo A', kind: 'client', status: 'active', financeClientId: null, reportTimeZone: DEMO_REPORT_TZ },
    { id: 'cli_demo_b', name: 'Cliente Exemplo B', kind: 'client', status: 'active', financeClientId: null, reportTimeZone: DEMO_REPORT_TZ },
    { id: 'cli_demo_c', name: 'Cliente Exemplo C', kind: 'client', status: 'active', financeClientId: null, reportTimeZone: DEMO_REPORT_TZ },
    { id: 'cli_demo_d', name: 'Cliente Exemplo D', kind: 'client', status: 'active', financeClientId: null, reportTimeZone: DEMO_REPORT_TZ },
  ]
  const connections: Connection[] = [
    { id: 'conn_demo_google', provider: 'google', label: 'Google · login da agência (demonstração)', authKind: 'oauth_user', status: 'active',
      scopes: ['Google Ads (leitura)', 'Analytics (leitura)', 'Tag Manager (leitura)'], lastVerifiedAt: ago(2), lastErrorCode: null },
    { id: 'conn_demo_meta_agency', provider: 'meta', label: 'Meta · portfólio da agência (demonstração)', authKind: 'system_user', status: 'active',
      scopes: ['ads_read'], lastVerifiedAt: ago(3), lastErrorCode: null },
    { id: 'conn_demo_meta_b', provider: 'meta', label: 'Meta · portfólio do Cliente Exemplo B (demonstração)', authKind: 'system_user', status: 'expired',
      scopes: ['ads_read'], lastVerifiedAt: ago(24 * 9), lastErrorCode: 'AUTH_EXPIRED' },
  ]
  const g = (id: string, ext: string, name: string, tz: string, o: Partial<Asset> = {}): Asset => ({ id, platform: 'google_ads', externalId: ext, externalContext: '', name,
    currencyCode: 'BRL', timeZone: tz, accountStatus: 'active', connectionId: 'conn_demo_google', accessPath: 'direct', loginCustomerId: null, ...o })
  const m = (id: string, ext: string, name: string, ccy: string, tz: string, conn: string | null, o: Partial<Asset> = {}): Asset => ({ id, platform: 'meta_ads', externalId: ext,
    externalContext: '', name, currencyCode: ccy, timeZone: tz, accountStatus: 'active', connectionId: conn, accessPath: conn ? 'direct' : null, loginCustomerId: null, ...o })
  const assets: Asset[] = [
    g('ast_demo_g_agency', '9000000101', 'Cassiellos Demo · Aquisição', DEMO_REPORT_TZ),
    m('ast_demo_m_agency', '900000000000101', 'Cassiellos Demo · Meta', 'BRL', DEMO_REPORT_TZ, 'conn_demo_meta_agency'),
    g('ast_demo_g_a1', '9000000201', 'Exemplo A · Pesquisa', DEMO_REPORT_TZ),
    g('ast_demo_g_a2', '9000000202', 'Exemplo A · Filial Norte', 'America/Manaus', { accountStatus: 'paused', accessPath: 'manager', loginCustomerId: '9000000001' }),
    g('ast_demo_g_a3', '9000000203', 'Exemplo A · Conta encontrada pela busca', DEMO_REPORT_TZ),
    { id: 'ast_demo_ga4_a', platform: 'ga4', externalId: '900000201', externalContext: '', name: 'Exemplo A · Site', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ,
      accountStatus: 'active', connectionId: 'conn_demo_google', accessPath: 'direct', loginCustomerId: null },
    { id: 'ast_demo_gtm_a', platform: 'gtm', externalId: 'GTM-DEMOA01', externalContext: '9000201', name: 'Exemplo A · Contêiner do site', currencyCode: null, timeZone: null,
      accountStatus: 'active', connectionId: 'conn_demo_google', accessPath: 'direct', loginCustomerId: null },
    m('ast_demo_m_b', '900000000000301', 'Exemplo B · Loja', 'BRL', DEMO_REPORT_TZ, 'conn_demo_meta_b'),
    g('ast_demo_g_b_nf', '9000000301', 'Exemplo B · Conta informada pelo cliente', DEMO_REPORT_TZ, { connectionId: null, accessPath: null, accountStatus: 'unknown', currencyCode: null, timeZone: null }),
    g('ast_demo_g_c', '9000000401', 'Exemplo C · Brasil', DEMO_REPORT_TZ),
    m('ast_demo_m_c_us', '900000000000401', 'Exemplo C · Estados Unidos', 'USD', 'America/New_York', 'conn_demo_meta_agency'),
    m('ast_demo_m_c_susp', '900000000000402', 'Exemplo C · Conta suspensa', 'BRL', DEMO_REPORT_TZ, 'conn_demo_meta_agency', { accountStatus: 'suspended' }),
    { id: 'ast_demo_ga4_c', platform: 'ga4', externalId: '900000401', externalContext: '', name: 'Exemplo C · Site', currencyCode: null, timeZone: null,
      accountStatus: 'unknown', connectionId: null, accessPath: null, loginCustomerId: null },
  ]
  const link = (clientId: string, assetId: string, status: ClientAsset['status'], note = ''): ClientAsset =>
    ({ clientId, assetId, status, validatedAt: status === 'confirmed' ? ago(24 * 20) : null, note })
  const links: ClientAsset[] = [
    link('cli_demo_cassiellos', 'ast_demo_g_agency', 'confirmed'),
    link('cli_demo_cassiellos', 'ast_demo_m_agency', 'confirmed'),
    link('cli_demo_a', 'ast_demo_g_a1', 'confirmed'),
    link('cli_demo_a', 'ast_demo_g_a2', 'confirmed', 'Acesso pela conta gerente (MCC) de demonstração'),
    link('cli_demo_a', 'ast_demo_g_a3', 'probable', 'Nome semelhante; aguardando confirmação do titular'),
    link('cli_demo_a', 'ast_demo_ga4_a', 'confirmed'),
    link('cli_demo_a', 'ast_demo_gtm_a', 'confirmed'),
    link('cli_demo_b', 'ast_demo_m_b', 'confirmed'),
    link('cli_demo_b', 'ast_demo_g_b_nf', 'not_found', 'Conta informada não aparece entre as contas acessíveis'),
    link('cli_demo_c', 'ast_demo_g_c', 'confirmed'),
    link('cli_demo_c', 'ast_demo_m_c_us', 'confirmed', 'Conta em dólar (USD)'),
    link('cli_demo_c', 'ast_demo_m_c_susp', 'confirmed'),
    link('cli_demo_c', 'ast_demo_ga4_c', 'no_access', 'Propriedade sem permissão de leitura'),
  ]

  const G = { dailyImpressions: 5200, ctrPct: 4.1, cpcMicros: 2_350_000, conversionRate: 0.08 }
  const M = { dailyImpressions: 21000, ctrPct: 1.15, cpcMicros: 980_000, conversionRate: 0.11 }
  const adAccounts: MockAdAccountSpec[] = [
    { platform: 'google_ads', externalId: '9000000101', name: 'Cassiellos Demo · Aquisição', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: null, campaigns: [
      camp(today, '81001', 'Diagnóstico · Pesquisa', 'SEARCH', { from: -150 }, { ...G, dailyImpressions: 1900, cpcMicros: 3_100_000 }),
      camp(today, '81002', 'Diagnóstico · Performance Max', 'PERFORMANCE_MAX', { from: -80 }, { ...G, dailyImpressions: 6400, ctrPct: 1.4, cpcMicros: 1_450_000, conversionRate: 0.05 }),
      camp(today, '81003', 'Remarketing · Display', 'DISPLAY', { from: -150, until: -21 }, { ...G, dailyImpressions: 9000, ctrPct: 0.6, cpcMicros: 700_000, conversionRate: 0.02 }),
    ] },
    { platform: 'meta_ads', externalId: '900000000000101', name: 'Cassiellos Demo · Meta', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: '9000000000000099', campaigns: [
      camp(today, '120001', 'Diagnóstico · Leads Odontologia', 'LEADS', { from: -150, gaps: [{ start: addDays(today, -44), end: addDays(today, -38) }] }, { ...M, dailyImpressions: 15000 }),
      camp(today, '120002', 'Diagnóstico · Advantage+', 'LEADS', { from: -60 }, { ...M, cpcMicros: 1_150_000 }),
      camp(today, '120003', 'Teste criativo · Vídeo', 'AWARENESS', { from: -100, until: -30 }, { ...M, conversionRate: null }),
    ] },
    { platform: 'google_ads', externalId: '9000000201', name: 'Exemplo A · Pesquisa', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: null, campaigns: [
      camp(today, '82001', 'Institucional · Marca', 'SEARCH', { from: -150 }, { ...G, dailyImpressions: 2600, ctrPct: 7.8, cpcMicros: 900_000, conversionRate: 0.12 }),
      camp(today, '82002', 'Serviços · Região metropolitana', 'SEARCH', { from: -150 }, { ...G, dailyImpressions: 4100, cpcMicros: 2_900_000 }),
      camp(today, '82003', 'Promoção sazonal', 'SEARCH', { from: -70, until: -15 }, { ...G, dailyImpressions: 3000, cpcMicros: 2_200_000 }),
    ] },
    { platform: 'google_ads', externalId: '9000000202', name: 'Exemplo A · Filial Norte', currencyCode: 'BRL', timeZone: 'America/Manaus', status: 'paused', parentExternalId: '9000000001', campaigns: [
      camp(today, '82101', 'Filial Norte · Pesquisa', 'SEARCH', { from: -140, until: -45 }, { ...G, dailyImpressions: 1600, cpcMicros: 1_800_000 }),
    ] },
    { platform: 'google_ads', externalId: '9000000203', name: 'Exemplo A · Conta encontrada pela busca', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: null, campaigns: [
      camp(today, '82201', 'Campanha não validada', 'SEARCH', { from: -90 }, { ...G, dailyImpressions: 900 }),
    ] },
    { platform: 'meta_ads', externalId: '900000000000301', name: 'Exemplo B · Loja', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: '9000000000000301', campaigns: [
      camp(today, '130001', 'Catálogo · Vendas', 'SALES', { from: -150 }, { ...M, dailyImpressions: 26000, ctrPct: 1.6, cpcMicros: 620_000, conversionRate: 0.03 }),
      camp(today, '130002', 'Mensagens · WhatsApp', 'ENGAGEMENT', { from: -110 }, { ...M, dailyImpressions: 9000, conversionRate: null }),
    ] },
    { platform: 'google_ads', externalId: '9000000401', name: 'Exemplo C · Brasil', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'active', parentExternalId: null, campaigns: [
      camp(today, '83001', 'Pesquisa · Produto principal', 'SEARCH', { from: -150 }, { ...G, dailyImpressions: 3300, cpcMicros: 2_600_000 }),
      camp(today, '83002', 'Shopping · Catálogo', 'SHOPPING', { from: -120 }, { ...G, dailyImpressions: 7200, ctrPct: 1.1, cpcMicros: 750_000, conversionRate: 0.03 }),
      camp(today, '83003', 'YouTube · Alcance', 'VIDEO', { from: -60 }, { ...G, dailyImpressions: 14000, ctrPct: 0.3, cpcMicros: 450_000, conversionRate: null }),
    ] },
    { platform: 'meta_ads', externalId: '900000000000401', name: 'Exemplo C · Estados Unidos', currencyCode: 'USD', timeZone: 'America/New_York', status: 'active', parentExternalId: '9000000000000099', campaigns: [
      camp(today, '140001', 'US · Leads', 'LEADS', { from: -100 }, { ...M, dailyImpressions: 8000, cpcMicros: 1_900_000, conversionRate: 0.07 }),
    ] },
    { platform: 'meta_ads', externalId: '900000000000402', name: 'Exemplo C · Conta suspensa', currencyCode: 'BRL', timeZone: DEMO_REPORT_TZ, status: 'suspended', parentExternalId: '9000000000000099', campaigns: [
      camp(today, '140101', 'Tráfego · Site', 'TRAFFIC', { from: -130, until: -20 }, { ...M, dailyImpressions: 12000, conversionRate: null }),
    ] },
  ]
  const ga4: MockGa4Spec[] = [
    { externalId: '900000201', name: 'Exemplo A · Site', timeZone: DEMO_REPORT_TZ, currencyCode: 'BRL', accountExternalId: '90002', dailySessions: 640, activeFrom: addDays(today, -150) },
  ]
  const gtm: MockGtmSpec[] = [
    { publicId: 'GTM-DEMOA01', accountExternalId: '9000201', containerExternalId: '9100201', name: 'Exemplo A · Contêiner do site',
      diagnostics: { liveVersionId: '27', lastPublishedAt: ago(24 * 16), tagCount: 14, hasGa4Tag: true, hasMetaPixelTag: false } },
  ]
  return {
    clients, connections, assets, links, adAccounts, ga4, gtm,
    staleDays: { ast_demo_m_b: 9 },
    latestRunFaults: {
      // Exemplo C · Brasil: 2ª página de métricas falha repetidamente → sincronização PARCIAL.
      '9000000401': { kind: 'transient', calls: [4, 5, 6, 7] },
      // Meta da agência: um 429 com Retry-After na 1ª página → nova tentativa e sucesso.
      '900000000000101': { kind: 'rate_limited', retryAfterSeconds: 2, calls: [3] },
    },
  }
}

/**
 * Funil comercial SIMULADO da Cassiellos (leads e reuniões por canal e dia). NÃO consulta o CRM real: na fundação, a
 * área Prospecção usa somente estes números fictícios, derivados dos cliques simulados.
 */
export type SimulatedFunnelDay = { day: CivilDate; channel: 'google_ads' | 'meta_ads' | 'unattributed'; leads: number; meetings: number }
