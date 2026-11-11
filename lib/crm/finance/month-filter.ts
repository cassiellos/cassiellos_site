/**
 * Recorte MENSAL das listas do Financeiro (somente apresentação; nada é gravado nem recalculado).
 *
 * - "due" (Vencimento): lançamentos cujo vencimento (`due_date`) cai no mês selecionado, em ordem cronológica.
 * - "competence" (Competência): lançamentos cuja competência (`competence_month`) é o mês selecionado.
 *
 * As datas chegam do banco como texto civil (`due_date::text` = "AAAA-MM-DD"; competência = "AAAA-MM") e são
 * comparadas como TEXTO pelo prefixo "AAAA-MM": nenhuma conversão para Date/fuso horário, então um vencimento em
 * 01/12 nunca "volta" para 30/11 nem avança de dia por causa do horário de Brasília/UTC.
 * DRE, relatórios por competência, KPIs e caixa continuam com suas próprias consultas e bases de cálculo.
 */

export type MonthBasis = 'due' | 'competence'

export const MONTH_BASIS_LABEL: Record<MonthBasis, string> = { due: 'Vencimento', competence: 'Competência' }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Mês civil "AAAA-MM" de uma data "AAAA-MM-DD" (texto, sem fuso). Inválida → null. */
export function civilMonthOf(date: string | null | undefined): string | null {
  return typeof date === 'string' && DATE.test(date) ? date.slice(0, 7) : null
}

type MonthEntry = { dueDate: string; competenceMonth: string; id: string }

/** Filtra pelo critério escolhido. Vencimento: ordem cronológica do vencimento (desempate estável por id). */
export function entriesForMonth<T extends MonthEntry>(list: readonly T[], month: string, basis: MonthBasis): T[] {
  if (!MONTH.test(month)) return []
  if (basis === 'competence') return list.filter(e => e.competenceMonth === month)
  return list.filter(e => civilMonthOf(e.dueDate) === month)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
}

type TotalsEntry = { state: string; clientAdBudget: boolean; amountCents: number; settledCents: number; remainingCents: number }

/** Totais da lista exibida (cancelados e verba de cliente ficam fora, como nos demais totais do Financeiro). */
export function monthListTotals(list: readonly TotalsEntry[]): { expectedCents: number; receivedCents: number; openCents: number } {
  const counted = list.filter(e => e.state !== 'cancelled' && !e.clientAdBudget)
  return {
    expectedCents: counted.reduce((s, e) => s + e.amountCents, 0),
    receivedCents: counted.reduce((s, e) => s + e.settledCents, 0),
    openCents: counted.reduce((s, e) => s + e.remainingCents, 0),
  }
}
