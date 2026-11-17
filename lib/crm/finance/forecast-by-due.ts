import { entriesForMonth } from './month-filter'

/**
 * Painéis OPERACIONAIS de previsão são por VENCIMENTO, e não competência.
 * Os relatórios contábeis e a movimentação efetiva de caixa usam seus
 * próprios critérios e não são recalculados por esta função.
 *
 * Exemplo Creative Minds: competência 11/2026, vencimento 01/12/2026.
 * A cobrança entra na PREVISÃO de dezembro, jamais na de novembro.
 */
export type OperationalRevenueEntry = {
  id: string
  direction: 'in' | 'out'
  category: string
  competenceMonth: string
  dueDate: string
  state: string
  amountCents: number
  remainingCents: number
  clientAdBudget: boolean
}

export function forecastRevenueByDue<T extends OperationalRevenueEntry>(entries: readonly T[], month: string) {
  const list = entriesForMonth(entries.filter(e => e.direction === 'in' && e.state !== 'cancelled' && !e.clientAdBudget), month, 'due')
  const expectedCents = list.reduce((n,e) => n + e.amountCents,0)
  const openCents = list.reduce((n,e) => n + Math.max(0,e.remainingCents),0)
  const byCategory: Record<string,number> = {}
  for (const e of list) byCategory[e.category] = (byCategory[e.category]||0)+e.amountCents
  return { list, expectedCents, openCents, byCategory }
}
