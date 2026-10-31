/**
 * Financeiro do CRM | Cassiellos — regras puras (sem banco, sem framework), usadas no servidor e no navegador.
 *
 * - Valores SEMPRE em centavos inteiros. Nunca float para dinheiro: a conversão de texto pt-BR é feita por dígitos.
 * - COMPETÊNCIA = mês a que a cobrança/conta pertence. CAIXA = mês em que o dinheiro entrou/saiu (data real do
 *   movimento). Os dois nunca se misturam: cada indicador declara a base usada.
 * - Estados ("Recebido", "Parcial", "Atrasado"...) são DERIVADOS dos movimentos reais, nunca digitados.
 */

export const MAX_CENTS = 100_000_000_000 // R$ 1 bilhão: teto de sanidade (mesmo limite das constraints da 0011)
export const TIME_ZONE = 'America/Sao_Paulo'

export const REVENUE_CATEGORIES = {
  marketing_monthly: 'Contrato mensal de marketing',
  creative_minds: 'Creative Minds — assinatura',
  hosting: 'Hospedagem de sites',
  site_maintenance: 'Manutenção de sites',
  site_creation: 'Criação de sites e landing pages',
  project: 'Projetos e serviços avulsos',
  other_revenue: 'Outras receitas',
} as const
export const EXPENSE_CATEGORIES = {
  infrastructure: 'Hospedagem e infraestrutura',
  software: 'Softwares e assinaturas',
  team: 'Equipe e prestadores',
  agency_ads: 'Publicidade da agência',
  taxes: 'Impostos e taxas',
  office: 'Escritório',
  outsourced: 'Serviços terceirizados',
  other_expense: 'Outras despesas',
} as const
export type RevenueCategory = keyof typeof REVENUE_CATEGORIES
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES
export type Direction = 'in' | 'out'

export const PERIODICITIES = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', one_time: 'Única (avulsa)' } as const
export type Periodicity = keyof typeof PERIODICITIES
export const PERIODICITY_STEP: Record<Periodicity, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, one_time: 0 }
export const SOURCE_STATUS = { active: 'Ativo', paused: 'Pausado', ended: 'Encerrado' } as const
export type SourceStatus = keyof typeof SOURCE_STATUS
export const INVOICE_STATUS = { pending: 'Nota pendente', issued: 'Emitida', not_applicable: 'Não aplicável', cancelled: 'Cancelada' } as const
export type InvoiceStatus = keyof typeof INVOICE_STATUS

/**
 * Controles ADMINISTRATIVOS dos contratos/serviços (migração 0012) — independentes do status financeiro
 * (SOURCE_STATUS): não bloqueiam cadastro, cobrança nem recebimento e nunca geram/cancelam lançamentos.
 * Padrão sempre "Não informado"; nada é considerado "Assinado" automaticamente.
 */
export const SERVICE_STATUS = {
  unknown: 'Não informado', not_started: 'Não iniciado', in_progress: 'Em andamento', paused: 'Pausado', ended: 'Encerrado',
} as const
export type ServiceStatus = keyof typeof SERVICE_STATUS
export const FORMALIZATION_STATUS = {
  unknown: 'Não informado', not_sent: 'Não enviado', sent: 'Enviado', awaiting_signature: 'Aguardando assinatura', signed: 'Assinado',
  no_formal_contract: 'Sem contrato formal',
} as const
export type FormalizationStatus = keyof typeof FORMALIZATION_STATUS
export const isServiceStatus = (v: unknown): v is ServiceStatus => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SERVICE_STATUS, v)
export const isFormalizationStatus = (v: unknown): v is FormalizationStatus => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORMALIZATION_STATUS, v)

export function categoryLabel(category: string): string {
  return (REVENUE_CATEGORIES as Record<string, string>)[category] ?? (EXPENSE_CATEGORIES as Record<string, string>)[category] ?? category
}
export function isCategoryOf(direction: Direction, category: unknown): boolean {
  return typeof category === 'string' && Object.prototype.hasOwnProperty.call(direction === 'in' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES, category)
}

// ───────────────────────── dinheiro ─────────────────────────

/**
 * Converte o que o administrador digitou (pt-BR) em centavos. Aceita "1.234,56", "1234,56", "1234.56", "R$ 2.000",
 * "800". Recusa negativos, mais de 2 casas decimais, notação científica e qualquer coisa ambígua.
 */
export function parseMoneyToCents(raw: unknown): number | null {
  // Números crus (JSON) não são aceitos: seriam float e ambíguos. O valor chega sempre como texto.
  if (typeof raw !== 'string' || raw.length > 30) return null
  let s = raw.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '')
  if (!s || !/^[\d.,]+$/.test(s)) return null
  let intPart: string
  let decPart = ''
  if (s.includes(',')) {
    // vírgula = decimal; pontos = milhar (só em grupos de 3)
    if (s.indexOf(',') !== s.lastIndexOf(',')) return null
    ;[intPart, decPart] = s.split(',')
    if (intPart.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null
    intPart = intPart.replace(/\./g, '')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replace(/\./g, '') // "2.000" = dois mil
  } else {
    if ((s.match(/\./g) || []).length > 1) return null
    ;[intPart, decPart = ''] = s.split('.')
  }
  if (!/^\d+$/.test(intPart || '0') || !/^\d{0,2}$/.test(decPart)) return null
  s = (intPart || '0').replace(/^0+(?=\d)/, '')
  if (s.length > 12) return null
  const cents = Number(s) * 100 + Number((decPart + '00').slice(0, 2))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Formata centavos como "R$ 1.234,56" (aritmética só com inteiros; a divisão é apenas para exibir). */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ')
}
/** Valor para preencher um campo de edição ("1234,56"). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents)
  return (cents < 0 ? '-' : '') + Math.floor(abs / 100) + ',' + String(abs % 100).padStart(2, '0')
}

// ───────────────────────── datas ─────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}
export function isValidMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = MONTH_RE.exec(value)
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 && Number(m[2]) >= 1 && Number(m[2]) <= 12
}
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
/** Data de hoje em Brasília (AAAA-MM-DD). */
export function todayInBrazil(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export const monthOf = (date: string): string => date.slice(0, 7)
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return Math.floor(idx / 12) + '-' + String((idx % 12) + 1).padStart(2, '0')
}
export const monthDiff = (from: string, to: string): number => {
  const [a, b] = [from.split('-').map(Number), to.split('-').map(Number)]
  return (b[0] * 12 + b[1]) - (a[0] * 12 + a[1])
}
export const firstDay = (month: string): string => month + '-01'
export function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return month + '-' + String(daysInMonth(y, m)).padStart(2, '0')
}
/** Vencimento no mês de competência: dia escolhido, limitado ao último dia do mês (ex.: 31 → 28/29 em fevereiro). */
export function dueDateFor(month: string, dueDay: number): string {
  const [y, m] = month.split('-').map(Number)
  return month + '-' + String(Math.min(dueDay, daysInMonth(y, m))).padStart(2, '0')
}
const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const monthLabel = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] + '/' + month.slice(0, 4)
export const shortMonth = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1]
export const formatDate = (date: string | null): string => date ? date.slice(8, 10) + '/' + date.slice(5, 7) + '/' + date.slice(0, 4) : '—'

// ───────────────────────── recorrência ─────────────────────────

export type GenerationSource = {
  periodicity: Periodicity
  startDate: string
  endDate: string | null
  generateFrom: string // AAAA-MM-01
  status: SourceStatus
  dueDay: number
}

/**
 * Meses de competência que a origem deve ter até `horizonMonth` (inclusive). Alinhados ao mês de início pela
 * periodicidade (trimestral = início, +3, +6...). Origem pausada ou encerrada não gera nada novo; nada antes de
 * `generateFrom` nem depois do mês de término. A gravação é idempotente (único por origem + mês), então chamar de
 * novo nunca duplica.
 */
export function competenceMonths(source: GenerationSource, horizonMonth: string): string[] {
  if (source.status !== 'active') return []
  const start = monthOf(source.startDate)
  const from = monthOf(source.generateFrom)
  const endMonth = source.endDate ? monthOf(source.endDate) : null
  const limit = endMonth && monthDiff(endMonth, horizonMonth) > 0 ? endMonth : horizonMonth
  if (source.periodicity === 'one_time') return monthDiff(from, start) >= 0 && monthDiff(start, limit) >= 0 ? [start] : []
  const step = PERIODICITY_STEP[source.periodicity]
  const out: string[] = []
  // primeiro mês alinhado >= generateFrom
  const offset = Math.max(0, monthDiff(start, from))
  let k = Math.ceil(offset / step)
  for (let guard = 0; guard < 400; guard++, k++) {
    const month = addMonths(start, k * step)
    if (monthDiff(month, limit) < 0) break
    out.push(month)
  }
  return out
}

/** Valor mensal equivalente (para "receita recorrente"): anual/12 etc., arredondado ao centavo. */
export function monthlyEquivalentCents(amountCents: number, periodicity: Periodicity): number {
  const step = PERIODICITY_STEP[periodicity]
  return step ? Math.round(amountCents / step) : 0
}

// ───────────────────────── estado derivado ─────────────────────────

export type EntryState = 'cancelled' | 'settled' | 'partial' | 'overdue' | 'forecast' | 'open'
export function entryState(e: { status: 'open' | 'cancelled'; amountCents: number; settledCents: number; dueDate: string; competenceMonth: string },
  today: string): EntryState {
  if (e.status === 'cancelled') return 'cancelled'
  if (e.settledCents >= e.amountCents) return 'settled'
  if (e.settledCents > 0) return 'partial'
  if (e.dueDate < today) return 'overdue'
  if (monthOf(e.competenceMonth) > monthOf(today)) return 'forecast'
  return 'open'
}
export const STATE_LABEL: Record<Direction, Record<EntryState, string>> = {
  in: { cancelled: 'Cancelado', settled: 'Recebido', partial: 'Parcialmente recebido', overdue: 'Atrasado', forecast: 'Previsto', open: 'A receber' },
  out: { cancelled: 'Cancelado', settled: 'Pago', partial: 'Parcialmente pago', overdue: 'Atrasado', forecast: 'Previsto', open: 'A pagar' },
}

/** Evolução percentual. Base zero (ou negativa, para resultado) → "não comparável", nunca infinito nem invenção. */
export function percentChange(current: number, previous: number): { comparable: true; percent: number } | { comparable: false } {
  if (previous <= 0) return { comparable: false }
  return { comparable: true, percent: Math.round(((current - previous) / previous) * 1000) / 10 }
}
export function formatChange(current: number, previous: number): string {
  const c = percentChange(current, previous)
  if (!c.comparable) return 'não comparável'
  return (c.percent > 0 ? '+' : '') + c.percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

// ───────────────────────── CSV ─────────────────────────

/** Célula CSV segura: aspas escapadas e neutralização de fórmulas (=, +, -, @) contra injeção em planilhas. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[";\n\r]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s
}
/** Centavos no formato de planilha brasileira (1234,56), sem separador de milhar. */
export const csvMoney = (cents: number): string => centsToInput(cents)
