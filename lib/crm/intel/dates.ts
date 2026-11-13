/**
 * Central de Inteligência — DATAS CIVIS (sem fuso implícito).
 *
 * As plataformas de anúncios entregam métricas por "dia da conta": a data civil no fuso configurado na própria conta
 * (ex.: America/Sao_Paulo, America/Manaus, America/New_York). Por isso as datas circulam SEMPRE como texto
 * "AAAA-MM-DD" e a aritmética é feita sobre o calendário (via Date.UTC), nunca com Date local — um vencimento ou um
 * dia de veiculação nunca "volta" ou "avança" por causa do fuso do servidor (a Vercel roda em UTC).
 * O único ponto que usa fuso é `civilDateInZone`: converter um INSTANTE (agora) na data civil de uma conta.
 */

export type CivilDate = string // "AAAA-MM-DD"

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parts(date: CivilDate): [number, number, number] {
  if (!isCivilDate(date)) throw new RangeError('data civil inválida: ' + String(date))
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))]
}

function fromUtcMs(ms: number): CivilDate {
  const d = new Date(ms)
  return d.getUTCFullYear().toString().padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}

const DAY_MS = 86_400_000

export function addDays(date: CivilDate, days: number): CivilDate {
  const [y, m, d] = parts(date)
  return fromUtcMs(Date.UTC(y, m - 1, d) + days * DAY_MS)
}

/** Diferença em dias de calendário (b − a). */
export function diffDays(a: CivilDate, b: CivilDate): number {
  const [ya, ma, da] = parts(a)
  const [yb, mb, db] = parts(b)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS)
}

/** Lista inclusiva de datas [start, end]; vazia se end < start. */
export function eachDay(start: CivilDate, end: CivilDate): CivilDate[] {
  const n = diffDays(start, end)
  const out: CivilDate[] = []
  for (let i = 0; i <= n; i++) out.push(addDays(start, i))
  return out
}

export function monthOf(date: CivilDate): string { parts(date); return date.slice(0, 7) }
export function firstOfMonth(date: CivilDate): CivilDate { parts(date); return date.slice(0, 8) + '01' }
export function lastOfMonth(date: CivilDate): CivilDate {
  const [y, m] = parts(date)
  return date.slice(0, 8) + String(daysInMonth(y, m)).padStart(2, '0')
}

/** Valida um identificador de fuso IANA aceito pelo runtime (ex.: "America/Manaus"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** Data civil de um INSTANTE no fuso informado (ex.: "agora" no fuso da conta publicitária). */
export function civilDateInZone(instant: Date, timeZone: string): CivilDate {
  if (!isTimeZone(timeZone)) throw new RangeError('fuso inválido: ' + String(timeZone))
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return get('year') + '-' + get('month') + '-' + get('day')
}

export type PeriodPreset = '7d' | '30d' | '90d' | 'this_month' | 'last_month'
export const PERIOD_PRESETS: readonly PeriodPreset[] = ['7d', '30d', '90d', 'this_month', 'last_month']
export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', this_month: 'Mês atual', last_month: 'Mês anterior',
}

export type DateRange = { start: CivilDate; end: CivilDate }

/**
 * Intervalo do período relativo ao "hoje" CIVIL de quem consulta (ou da conta).
 * - 7d/30d/90d: dias COMPLETOS terminando ontem (o dia corrente ainda está em consolidação nas plataformas).
 * - this_month: do dia 1 até hoje (inclui o dia corrente, sinalizado como parcial na interface).
 * - last_month: mês anterior inteiro (inclusive virada de ano).
 */
export function periodRange(preset: PeriodPreset, today: CivilDate): DateRange {
  const yesterday = addDays(today, -1)
  switch (preset) {
    case '7d': return { start: addDays(today, -7), end: yesterday }
    case '30d': return { start: addDays(today, -30), end: yesterday }
    case '90d': return { start: addDays(today, -90), end: yesterday }
    case 'this_month': return { start: firstOfMonth(today), end: today }
    case 'last_month': { const prev = addDays(firstOfMonth(today), -1); return { start: firstOfMonth(prev), end: prev } }
  }
}

export function inRange(date: CivilDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end // comparação de texto AAAA-MM-DD = ordem cronológica
}

/** Janela de sincronização: revisão diária dos últimos N dias completos (padrão 7) ou reprocessamento (30). */
export function syncWindow(todayInAccountZone: CivilDate, lookbackDays: number): DateRange {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 400) throw new RangeError('janela inválida')
  return { start: addDays(todayInAccountZone, -lookbackDays), end: addDays(todayInAccountZone, -1) }
}
