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

/**
 * Competência da cobrança — SEM heurística:
 *  - competência já registrada para esta cobrança: permanece (mudar o vencimento depois não a altera); se o
 *    vencimento ORIGINAL informado agora contradiz o registrado → revisão (COMPETENCE_CONFLICT);
 *  - vencimento original informado pelo Asaas (originalDueDate): mês dele;
 *  - sem vencimento original: mês do vencimento atual, MAS só é aceito se esse vencimento for exatamente o previsto
 *    no lançamento do CRM (verificado em matchPayment); caso contrário → revisão (COMPETENCE_UNCERTAIN).
 */
export type CompetenceResolution =
  | { status: 'resolved'; competenceMonth: string; basis: 'original_due_date' | 'due_date'; originalDueDate: string | null }
  | { status: 'conflict'; reason: 'COMPETENCE_CONFLICT' }

export function resolveCompetence(p: Pick<NormalizedPayment, 'dueDate' | 'originalDueDate'>,
  stored: { competenceMonth: string | null; originalDueDate: string | null; basis: 'original_due_date' | 'due_date' | null }): CompetenceResolution {
  const original = stored.originalDueDate ?? p.originalDueDate
  if (stored.originalDueDate && p.originalDueDate && stored.originalDueDate !== p.originalDueDate) return { status: 'conflict', reason: 'COMPETENCE_CONFLICT' }
  if (stored.competenceMonth && stored.basis) {
    if (original && monthStart(original) !== stored.competenceMonth) return { status: 'conflict', reason: 'COMPETENCE_CONFLICT' }
    return { status: 'resolved', competenceMonth: stored.competenceMonth, basis: stored.basis, originalDueDate: original }
  }
  if (original) return { status: 'resolved', competenceMonth: monthStart(original), basis: 'original_due_date', originalDueDate: original }
  return { status: 'resolved', competenceMonth: monthStart(p.dueDate), basis: 'due_date', originalDueDate: null }
}
const monthStart = (date: string) => date.slice(0, 7) + '-01'

/** Atalho (sem histórico): competência pelo vencimento original, se houver; senão pelo vencimento. */
export const competenceOf = (payment: Pick<NormalizedPayment, 'dueDate'> & { originalDueDate?: string | null }): string =>
  monthStart(payment.originalDueDate ?? payment.dueDate)

export type EntryForMatch = { id: string; competenceMonth: string; dueDate: string; amountCents: number; status: 'open' | 'cancelled' }

export type MatchResult =
  | { status: 'linked'; entryId: string; competenceMonth: string; basis: 'original_due_date' | 'due_date'; divergences: string[] }
  | { status: 'review'; competenceMonth: string | null; reason: 'DUPLICATE_COMPETENCE' | 'COMPETENCE_UNCERTAIN' | 'COMPETENCE_CONFLICT'; entryId: string | null }
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
  /** Competência/vencimento original já registrados para esta cobrança (sincronizações anteriores). */
  stored?: { competenceMonth: string | null; originalDueDate: string | null; basis: 'original_due_date' | 'due_date' | null }
}): MatchResult {
  const resolved = resolveCompetence(input.payment, input.stored ?? { competenceMonth: null, originalDueDate: null, basis: null })
  if (resolved.status === 'conflict') return { status: 'review', competenceMonth: input.stored?.competenceMonth ?? null, reason: resolved.reason, entryId: null }
  const { competenceMonth, basis } = resolved
  if (!input.hasSubscriptionLink) return { status: 'unmatched', competenceMonth, reason: 'NO_SUBSCRIPTION_LINK' }
  const entry = input.entries.find(e => e.competenceMonth === competenceMonth)
  if (!entry) return { status: 'unmatched', competenceMonth, reason: 'ENTRY_NOT_GENERATED' }
  // Sem vencimento original: o vencimento atual só serve de evidência se for exatamente o previsto no CRM.
  if (basis === 'due_date' && input.payment.dueDate !== entry.dueDate) return { status: 'review', competenceMonth, reason: 'COMPETENCE_UNCERTAIN', entryId: entry.id }
  const other = input.primaryLinkedPaymentByEntry.get(entry.id)
  if (other && other !== input.payment.id) return { status: 'review', competenceMonth, reason: 'DUPLICATE_COMPETENCE', entryId: entry.id }
  const divergences: string[] = []
  if (input.payment.valueCents !== entry.amountCents) divergences.push('AMOUNT_MISMATCH')
  if (input.payment.dueDate !== entry.dueDate) divergences.push('DUE_DATE_MISMATCH')
  if (entry.status === 'cancelled') divergences.push('ENTRY_CANCELLED')
  return { status: 'linked', entryId: entry.id, competenceMonth, basis, divergences }
}

/**
 * Precedência entre fotografias com a MESMA data de evento (o Asaas informa segundos): só avança, nunca regride
 * (ex.: CONFIRMED e RECEIVED no mesmo segundo → fica RECEIVED, em qualquer ordem de chegada).
 */
export const STATE_RANK: Record<string, number> = {
  unknown: 0, open: 1, overdue: 2, confirmed: 3, received: 4, refund_pending: 5, partially_refunded: 6, chargeback: 7, refunded: 8, deleted: 9,
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
  /** Hoje (AAAA-MM-DD, Brasília): dinheiro com disponibilidade futura não vira caixa. */
  today: string
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

/**
 * Data de CAIXA = dinheiro disponível: data de crédito; na falta, a prevista; na falta, a do pagamento. Se for
 * FUTURA, a baixa espera (nunca é antecipada nem substituída pela data de hoje).
 */
export function cashDateOf(p: NormalizedPayment): string | null {
  return p.creditDate ?? p.estimatedCreditDate ?? p.paymentDate ?? p.clientPaymentDate ?? null
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
      if (settledOn > input.today) return { type: 'none', reason: 'AWAITING_CREDIT_DATE' }
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
