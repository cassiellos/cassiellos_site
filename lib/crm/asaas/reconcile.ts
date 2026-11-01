import { createHash } from 'node:crypto'
import type { Periodicity } from '../finance/model'
import type { AsaasCycle, AsaasEnvironment, NormalizedPayment, NormalizedSubscription } from './types'

/**
 * Regras PURAS de vínculo e conciliação Asaas ↔ Financeiro (sem banco, sem rede).
 *
 * Princípios:
 *  - COMPETÊNCIA de uma cobrança Asaas = mês do seu VENCIMENTO (dueDate). CAIXA = data em que o dinheiro ficou
 *    disponível (creditDate; na falta, a data do pagamento). As duas visões nunca se misturam.
 *  - Baixa no CRM somente quando o Asaas informa "recebido" (dinheiro disponível). "Confirmado" não é caixa.
 *  - A baixa registra o VALOR BRUTO (fecha o valor contratado); tarifa e líquido ficam guardados à parte. Nenhuma
 *    despesa de tarifa é criada automaticamente.
 *  - Qualquer situação sem critério seguro (valor divergente, baixa manual já existente, estorno parcial,
 *    chargeback, cobrança removida após recebida...) vira REVISÃO administrativa — nada é resolvido no escuro,
 *    nenhum valor histórico é alterado, nenhum lançamento é apagado.
 */

// ───────────────────────── contrato ↔ assinatura ─────────────────────────

export const CYCLE_FOR_PERIODICITY: Partial<Record<Periodicity, AsaasCycle>> = {
  monthly: 'MONTHLY', quarterly: 'QUARTERLY', semiannual: 'SEMIANNUALLY', annual: 'YEARLY',
}

export type SourceForLink = {
  direction: 'in' | 'out'; status: 'active' | 'paused' | 'ended'; periodicity: Periodicity; amountCents: number; dueDay: number
  installmentPlan: boolean; billingProvider: 'manual' | 'asaas_subscription' | 'asaas_charge'
}

/** Impedem o vínculo (a lógica de competência quebraria ou o contrato não é elegível). */
export const BLOCKING_LINK_CODES = ['SOURCE_NOT_REVENUE', 'SOURCE_INSTALLMENT_PLAN', 'SOURCE_ENDED', 'CYCLE_MISMATCH',
  'SOURCE_BILLED_BY_CRM', 'SUBSCRIPTION_DELETED'] as const

/**
 * Compara o contrato do CRM com a assinatura do Asaas ANTES do vínculo. Valor e dia de vencimento divergentes
 * NÃO impedem o vínculo (ficam sinalizados para revisão); ciclo incompatível e contratos inelegíveis impedem.
 */
export function compareSubscription(source: SourceForLink, sub: NormalizedSubscription): { blocking: string[]; divergences: string[] } {
  const blocking: string[] = []
  const divergences: string[] = []
  if (source.direction !== 'in') blocking.push('SOURCE_NOT_REVENUE')
  if (source.installmentPlan) blocking.push('SOURCE_INSTALLMENT_PLAN')
  if (source.status === 'ended') blocking.push('SOURCE_ENDED')
  if (source.billingProvider === 'asaas_charge') blocking.push('SOURCE_BILLED_BY_CRM')
  if (sub.deleted) blocking.push('SUBSCRIPTION_DELETED')
  if (CYCLE_FOR_PERIODICITY[source.periodicity] !== sub.cycle) blocking.push('CYCLE_MISMATCH')
  if (sub.valueCents !== source.amountCents) divergences.push('VALUE_MISMATCH')
  if (sub.nextDueDate && Number(sub.nextDueDate.slice(8, 10)) !== source.dueDay &&
    !(source.dueDay > 28 && isLastDayOfMonth(sub.nextDueDate))) divergences.push('DUE_DAY_MISMATCH')
  if (source.status === 'paused') divergences.push('SOURCE_PAUSED')
  return { blocking, divergences }
}

function isLastDayOfMonth(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d
}

// ───────────────────────── cobrança ↔ lançamento da competência ─────────────────────────

/** Competência da cobrança: mês do vencimento (AAAA-MM-01). */
export const competenceOf = (payment: Pick<NormalizedPayment, 'dueDate'>): string => payment.dueDate.slice(0, 7) + '-01'

export type EntryForMatch = { id: string; competenceMonth: string; dueDate: string; amountCents: number; status: 'open' | 'cancelled' }

export type MatchResult =
  | { status: 'linked'; entryId: string; competenceMonth: string; divergences: string[] }
  | { status: 'review'; competenceMonth: string; reason: 'DUPLICATE_COMPETENCE'; entryId: string }
  | { status: 'unmatched'; competenceMonth: string; reason: 'ENTRY_NOT_GENERATED' | 'NO_SUBSCRIPTION_LINK' }

/**
 * Liga a cobrança ao lançamento da MESMA competência do contrato vinculado. Se a competência já tem outra cobrança
 * principal ligada, a nova vai para REVISÃO (nunca dois vínculos principais na mesma competência).
 */
export function matchPayment(input: {
  payment: NormalizedPayment
  hasSubscriptionLink: boolean
  entries: EntryForMatch[]
  primaryLinkedPaymentByEntry: ReadonlyMap<string, string>
}): MatchResult {
  const competenceMonth = competenceOf(input.payment)
  if (!input.hasSubscriptionLink) return { status: 'unmatched', competenceMonth, reason: 'NO_SUBSCRIPTION_LINK' }
  const entry = input.entries.find(e => e.competenceMonth === competenceMonth)
  if (!entry) return { status: 'unmatched', competenceMonth, reason: 'ENTRY_NOT_GENERATED' }
  const other = input.primaryLinkedPaymentByEntry.get(entry.id)
  if (other && other !== input.payment.id) return { status: 'review', competenceMonth, reason: 'DUPLICATE_COMPETENCE', entryId: entry.id }
  const divergences: string[] = []
  if (input.payment.valueCents !== entry.amountCents) divergences.push('AMOUNT_MISMATCH')
  if (input.payment.dueDate !== entry.dueDate) divergences.push('DUE_DATE_MISMATCH')
  if (entry.status === 'cancelled') divergences.push('ENTRY_CANCELLED')
  return { status: 'linked', entryId: entry.id, competenceMonth, divergences }
}

// ───────────────────────── decisão de conciliação ─────────────────────────

export type Movement = { id: string; amountCents: number; reversed: boolean }

export type ReconcileInput = {
  environment: AsaasEnvironment
  payment: NormalizedPayment
  link: { status: 'unmatched' | 'linked' | 'review' | 'ignored'; isAdditional: boolean; manualOverlapConfirmed: boolean
    /** Valor diferente do contratado aceito pelo administrador, com justificativa (ex.: cobrança parcial). */
    divergenceAccepted?: boolean }
  entry: { id: string; status: 'open' | 'cancelled'; amountCents: number; settledCents: number } | null
  /** Movimentos já ligados a ESTA cobrança (recibos criados pela integração ou baixa manual confirmada). */
  linkedMovements: Movement[]
  /** Movimentos ativos do lançamento que NÃO pertencem a nenhuma cobrança Asaas (baixas manuais). */
  manualMovements: Movement[]
}

export type ReconcileAction =
  | { type: 'none'; reason: string }
  | { type: 'record_receipt'; amountCents: number; settledOn: string; idempotencyKey: string }
  | { type: 'link_manual'; settlementId: string }
  | { type: 'reverse'; settlementIds: string[]; reason: string }
  | { type: 'review'; code: string }

/**
 * Chave de idempotência DETERMINÍSTICA do recibo de uma cobrança: o mesmo evento/sincronização, repetido quantas
 * vezes for (inclusive após falha de rede ou reinício), gera a mesma chave — e o Financeiro aceita uma só baixa.
 */
export function receiptIdempotencyKey(environment: AsaasEnvironment, paymentId: string): string {
  const h = createHash('sha256').update('asaas:' + environment + ':' + paymentId + ':receipt').digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-' + variant + h.slice(17, 20) + '-' + h.slice(20, 32)
}

/** Data de CAIXA: dinheiro disponível (creditDate); na falta, data do pagamento informada pelo Asaas. */
export function cashDateOf(p: NormalizedPayment): string | null {
  return p.creditDate ?? p.paymentDate ?? p.clientPaymentDate ?? null
}

export function decideReconciliation(input: ReconcileInput): ReconcileAction {
  const { payment: p, link, entry } = input
  if (link.status === 'ignored') return { type: 'none', reason: 'IGNORED' }
  if (link.status !== 'linked') return { type: 'none', reason: 'NOT_LINKED' }
  if (!entry) return { type: 'review', code: 'ENTRY_MISSING' }
  const active = input.linkedMovements.filter(m => !m.reversed)
  const reversed = input.linkedMovements.filter(m => m.reversed)

  switch (p.state) {
    case 'received': {
      if (active.length) return { type: 'none', reason: 'ALREADY_SETTLED' }
      if (reversed.length) return { type: 'review', code: 'RECEIVED_AFTER_REVERSAL' }
      if (entry.status === 'cancelled') return { type: 'review', code: 'ENTRY_CANCELLED' }
      const manual = input.manualMovements.filter(m => !m.reversed)
      if (manual.length) {
        if (!link.manualOverlapConfirmed) return { type: 'review', code: 'MANUAL_SETTLEMENT_EXISTS' }
        const same = manual.filter(m => m.amountCents === p.valueCents)
        return same.length === 1 ? { type: 'link_manual', settlementId: same[0].id } : { type: 'review', code: 'MANUAL_SETTLEMENT_AMBIGUOUS' }
      }
      if (!link.isAdditional && !link.divergenceAccepted && p.valueCents !== entry.amountCents) return { type: 'review', code: 'AMOUNT_MISMATCH' }
      if (p.valueCents > entry.amountCents - entry.settledCents) return { type: 'review', code: 'AMOUNT_EXCEEDS_BALANCE' }
      const settledOn = cashDateOf(p)
      if (!settledOn) return { type: 'review', code: 'MISSING_PAYMENT_DATE' }
      return { type: 'record_receipt', amountCents: p.valueCents, settledOn, idempotencyKey: receiptIdempotencyKey(input.environment, p.id) }
    }
    case 'confirmed':
      return { type: 'none', reason: 'AWAITING_CREDIT' }
    case 'refunded':
      // Estorno TOTAL informado pelo Asaas: critério seguro para estornar os recibos criados pela integração.
      // Baixa manual confirmada como correspondente também é estornada (é o mesmo dinheiro devolvido).
      return active.length ? { type: 'reverse', settlementIds: active.map(m => m.id), reason: 'ASAAS_REFUNDED' } : { type: 'none', reason: 'NOTHING_TO_REVERSE' }
    case 'partially_refunded':
      return active.length ? { type: 'review', code: 'PARTIAL_REFUND' } : { type: 'none', reason: 'NOTHING_SETTLED' }
    case 'chargeback':
      return active.length ? { type: 'review', code: 'CHARGEBACK' } : { type: 'none', reason: 'NOTHING_SETTLED' }
    case 'refund_pending':
      return { type: 'none', reason: 'REFUND_PENDING' }
    case 'deleted':
      return active.length ? { type: 'review', code: 'DELETED_AFTER_RECEIPT' } : { type: 'none', reason: 'DELETED' }
    case 'open':
    case 'overdue':
      return active.length ? { type: 'review', code: 'RECEIPT_UNDONE' } : { type: 'none', reason: 'AWAITING_PAYMENT' }
    default:
      return { type: 'review', code: 'UNKNOWN_STATUS' }
  }
}
