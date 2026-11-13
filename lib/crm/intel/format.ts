/**
 * Formatação de exibição (pt-BR) da Central de Inteligência. Funções puras, usadas no navegador.
 * Datas civis "AAAA-MM-DD" são formatadas por TEXTO (sem Date/fuso). Instantes ISO usam o fuso de exibição informado.
 */
import type { MetricValue } from './metrics'

const moneyFmt = new Map<string, Intl.NumberFormat>()
function moneyFormatter(currency: string, digits: number) {
  const key = currency + digits
  let f = moneyFmt.get(key)
  if (!f) { f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }); moneyFmt.set(key, f) }
  return f
}

/** Micros → moeda. Valores altos sem centavos (legibilidade); CPC/CPL sempre com centavos. */
export function formatMoney(micros: number, currency: string, opts: { cents?: boolean } = {}): string {
  const value = micros / 1_000_000
  const digits = opts.cents || Math.abs(value) < 10_000 ? 2 : 0
  try { return moneyFormatter(currency, digits).format(value) } catch { return currency + ' ' + value.toFixed(digits) }
}

const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
export const formatInt = (n: number) => intFmt.format(n)
export const formatDecimal = (n: number) => decFmt.format(n)
export function formatPercent(n: number): string { return decFmt.format(n) + '%' }

/** MetricValue → texto. Ausência de dados ≠ zero ≠ sem base de cálculo. */
export function formatMetric(v: MetricValue, kind: 'money' | 'percent' | 'number', currency = 'BRL'): string {
  if (v.kind === 'no_data') return 'Sem dados'
  if (v.kind === 'zero_denominator') return '—'
  if (kind === 'money') return formatMoney(v.value, currency, { cents: true })
  if (kind === 'percent') return formatPercent(v.value)
  return formatDecimal(v.value)
}

export function metricTitle(v: MetricValue): string | undefined {
  if (v.kind === 'no_data') return 'Nenhum dado no período'
  if (v.kind === 'zero_denominator') return 'Sem base para cálculo (denominador zero)'
  return undefined
}

/** "2026-11-13" → "13/11" (curto) ou "13/11/2026". Sem conversão de fuso. */
export function formatCivil(date: string, withYear = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  return date.slice(8, 10) + '/' + date.slice(5, 7) + (withYear ? '/' + date.slice(0, 4) : '')
}

export function formatInstant(iso: string | null, timeZone = 'America/Sao_Paulo'): string {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** "há 3 h", "há 2 dias" — relativo a `now`. */
export function formatAgo(iso: string | null, now: Date): string {
  if (!iso) return 'nunca'
  const ms = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'há menos de 1 h'
  if (h < 48) return 'há ' + h + ' h'
  return 'há ' + Math.floor(h / 24) + ' dias'
}

/** Variação percentual vs período anterior (null quando não há base). */
export function deltaPct(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
