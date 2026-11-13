/**
 * Central de Inteligência — MÉTRICAS (funções puras).
 *
 * Regras:
 * - Dinheiro em MICROS inteiros (1 unidade = 1.000.000 micros, como a Google Ads API): sem ponto flutuante no total.
 *   `Number` representa micros com exatidão até ~9 bilhões de unidades monetárias por soma — muito acima do uso real.
 * - Taxas (CTR, CPC, CPM, CPL, custo por conversão) são calculadas SOBRE OS TOTAIS agregados, nunca pela média das taxas
 *   de cada campanha.
 * - Ausência de dados (null/undefined ou nenhuma linha) ≠ zero: `no_data` é diferente de `{ value: 0 }`.
 * - Denominador zero → `zero_denominator` (a interface mostra "—", não 0 nem infinito).
 * - Moedas diferentes NUNCA são somadas: agregação por moeda; total único só quando há uma moeda.
 * - Conversões são agrupadas por PLATAFORMA + DEFINIÇÃO + ATRIBUIÇÃO: conversões do Google e da Meta não são eventos
 *   únicos nem pessoas e não viram um "total de leads".
 * - ROAS, ROI e CAC não existem aqui: dependem de receita e atribuição comprovadas (fora da fundação).
 */

export type MetricValue =
  | { kind: 'value'; value: number }
  | { kind: 'no_data' }
  | { kind: 'zero_denominator' }

const NO_DATA: MetricValue = { kind: 'no_data' }
const ZERO_DEN: MetricValue = { kind: 'zero_denominator' }

type Num = number | null | undefined
const present = (n: Num): n is number => typeof n === 'number' && Number.isFinite(n)

function ratio(numerator: Num, denominator: Num, scale: number, round: (n: number) => number): MetricValue {
  if (!present(numerator) || !present(denominator)) return NO_DATA
  if (numerator < 0 || denominator < 0) return NO_DATA // métricas de veiculação nunca são negativas: dado inválido
  if (denominator === 0) return ZERO_DEN
  return { kind: 'value', value: round((numerator * scale) / denominator) }
}

const roundMicros = (n: number) => Math.round(n)
const roundRate = (n: number) => Math.round(n * 10_000) / 10_000 // 4 casas: precisão de exibição de percentuais

/** CTR (%) = cliques ÷ impressões × 100. */
export const ctr = (clicks: Num, impressions: Num) => ratio(clicks, impressions, 100, roundRate)
/** CPC (micros) = investimento ÷ cliques. */
export const cpcMicros = (costMicros: Num, clicks: Num) => ratio(costMicros, clicks, 1, roundMicros)
/** CPM (micros) = investimento ÷ impressões × 1.000. */
export const cpmMicros = (costMicros: Num, impressions: Num) => ratio(costMicros, impressions, 1000, roundMicros)
/** CPL (micros) = investimento ÷ leads ELEGÍVEIS (leads do CRM atribuídos ao canal — na fundação, simulados). */
export const cplMicros = (costMicros: Num, eligibleLeads: Num) => ratio(costMicros, eligibleLeads, 1, roundMicros)
/** Custo por conversão (micros) = investimento ÷ conversões DA MESMA definição/plataforma. */
export const costPerConversionMicros = (costMicros: Num, conversions: Num) => ratio(costMicros, conversions, 1, roundMicros)
/** Custo por reunião (micros) = investimento ÷ reuniões confirmadas elegíveis. */
export const costPerMeetingMicros = (costMicros: Num, meetings: Num) => ratio(costMicros, meetings, 1, roundMicros)

export type AdsPlatform = 'google_ads' | 'meta_ads'

/** Linha diária de anúncios já normalizada (por conta/campanha/dia civil da conta). */
export type AdsDailyFact = {
  platform: AdsPlatform
  assetId: string
  campaignId: string
  day: string
  currency: string
  impressions: number
  clicks: number
  costMicros: number
  /** null = a plataforma não informou conversões para a linha (≠ 0). */
  conversions: number | null
  conversionBasis: string
  attribution: string
}

export type CurrencyTotals = { currency: string; costMicros: number; impressions: number; clicks: number; rows: number }
export type ConversionGroup = {
  platform: AdsPlatform; basis: string; attribution: string; currency: string
  conversions: number; costMicros: number; rowsWithConversions: number
}

export type AdsSummary = {
  /** Nenhuma linha no recorte (≠ linhas com zero). */
  hasData: boolean
  byCurrency: CurrencyTotals[]
  conversions: ConversionGroup[]
}

/** Soma decimal estável para conversões (podem ser fracionárias no Google: atribuição baseada em dados). */
const addConv = (a: number, b: number) => Math.round((a + b) * 1_000_000) / 1_000_000

export function summarizeAds(rows: readonly AdsDailyFact[]): AdsSummary {
  const byCurrency = new Map<string, CurrencyTotals>()
  const conv = new Map<string, ConversionGroup>()
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { currency: r.currency, costMicros: 0, impressions: 0, clicks: 0, rows: 0 }
    t.costMicros += r.costMicros; t.impressions += r.impressions; t.clicks += r.clicks; t.rows += 1
    byCurrency.set(r.currency, t)
    const key = r.platform + '|' + r.conversionBasis + '|' + r.attribution + '|' + r.currency
    const g = conv.get(key) ?? { platform: r.platform, basis: r.conversionBasis, attribution: r.attribution, currency: r.currency, conversions: 0, costMicros: 0, rowsWithConversions: 0 }
    g.costMicros += r.costMicros
    if (r.conversions !== null) { g.conversions = addConv(g.conversions, r.conversions); g.rowsWithConversions += 1 }
    conv.set(key, g)
  }
  const sortCcy = (a: { currency: string }, b: { currency: string }) => a.currency.localeCompare(b.currency)
  return {
    hasData: rows.length > 0,
    byCurrency: [...byCurrency.values()].sort(sortCcy),
    conversions: [...conv.values()].sort((a, b) => a.platform.localeCompare(b.platform) || sortCcy(a, b) || a.basis.localeCompare(b.basis)),
  }
}

/** Total em uma única moeda; se houver mais de uma, NÃO soma (devolve null e a lista de moedas). */
export function singleCurrencyTotal(summary: AdsSummary): { total: CurrencyTotals | null; currencies: string[] } {
  const currencies = summary.byCurrency.map(c => c.currency)
  return { total: summary.byCurrency.length === 1 ? summary.byCurrency[0] : null, currencies }
}

export type DerivedRates = { ctr: MetricValue; cpcMicros: MetricValue; cpmMicros: MetricValue }
export function ratesFor(t: Pick<CurrencyTotals, 'costMicros' | 'impressions' | 'clicks'> | null | undefined): DerivedRates {
  if (!t) return { ctr: NO_DATA, cpcMicros: NO_DATA, cpmMicros: NO_DATA }
  return { ctr: ctr(t.clicks, t.impressions), cpcMicros: cpcMicros(t.costMicros, t.clicks), cpmMicros: cpmMicros(t.costMicros, t.impressions) }
}

/** Custo por conversão de um grupo: só quando a plataforma reportou conversões em alguma linha. */
export function conversionCost(g: ConversionGroup): MetricValue {
  if (g.rowsWithConversions === 0) return NO_DATA
  return costPerConversionMicros(g.costMicros, g.conversions)
}

/** Conversão de moeda SOMENTE com taxa identificada (fonte e data). Sem taxa → null (o valor não entra no total). */
export type FxRate = { from: string; to: string; day: string; rate: number; source: string }
export function convertMicros(micros: number, from: string, to: string, rate: FxRate | null): number | null {
  if (from === to) return micros
  if (!rate || rate.from !== from || rate.to !== to || !(rate.rate > 0) || !rate.source) return null
  return Math.round(micros * rate.rate)
}
