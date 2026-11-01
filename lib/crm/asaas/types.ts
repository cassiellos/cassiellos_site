/**
 * Integração Asaas — FASE 1 (fundação, sem rede). Tipos e normalização PUROS dos dados do Asaas.
 *
 * Nenhuma chamada HTTP existe nesta fase: tudo opera sobre objetos já recebidos (fixtures nos testes; no futuro, a
 * resposta da API ou o corpo do webhook). Valores do Asaas chegam em REAIS como número JSON (ex.: 69.9) e são
 * convertidos para CENTAVOS inteiros, com recusa de qualquer valor que não represente centavos exatos.
 */

export type AsaasEnvironment = 'sandbox' | 'production'
export const isAsaasEnvironment = (v: unknown): v is AsaasEnvironment => v === 'sandbox' || v === 'production'

/** Situação externa do Asaas reduzida ao que importa para o Financeiro. */
export type NormalizedState = 'open' | 'overdue' | 'confirmed' | 'received' | 'refund_pending' | 'refunded'
  | 'partially_refunded' | 'chargeback' | 'deleted' | 'unknown'

/**
 * CONFIRMED ≠ RECEIVED: "confirmado" = pagamento aprovado (ex.: cartão), dinheiro AINDA NÃO disponível;
 * "recebido" = valor disponível na conta. Só "received" vira baixa no caixa do CRM.
 */
const STATUS_MAP: Record<string, NormalizedState> = {
  PENDING: 'open', AWAITING_RISK_ANALYSIS: 'open', OVERDUE: 'overdue', DUNNING_REQUESTED: 'overdue',
  CONFIRMED: 'confirmed',
  RECEIVED: 'received', RECEIVED_IN_CASH: 'received', DUNNING_RECEIVED: 'received',
  REFUND_REQUESTED: 'refund_pending', REFUND_IN_PROGRESS: 'refund_pending',
  REFUNDED: 'refunded',
  CHARGEBACK_REQUESTED: 'chargeback', CHARGEBACK_DISPUTE: 'chargeback', AWAITING_CHARGEBACK_REVERSAL: 'chargeback',
}

export type AsaasCycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY'
export const ASAAS_CYCLES: readonly AsaasCycle[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']

export const CUSTOMER_ID = /^cus_[A-Za-z0-9]{1,64}$/
export const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,64}$/
export const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export class AsaasDataError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AsaasDataError' }
}

/**
 * Reais (número JSON do Asaas) → centavos inteiros. Recusa negativo, NaN, infinito e frações de centavo
 * (ex.: 10.005) — nunca arredonda silenciosamente um valor financeiro.
 */
export function asaasValueToCents(value: unknown, field = 'value'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new AsaasDataError('INVALID_' + field.toUpperCase())
  const cents = Math.round(value * 100)
  if (Math.abs(value * 100 - cents) > 1e-6 || !Number.isSafeInteger(cents) || cents > 100_000_000_000) {
    throw new AsaasDataError('INVALID_' + field.toUpperCase())
  }
  return cents
}

function date(value: unknown, field: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AsaasDataError('MISSING_' + field.toUpperCase())
    return null
  }
  if (typeof value !== 'string' || !DATE.test(value.slice(0, 10))) throw new AsaasDataError('INVALID_' + field.toUpperCase())
  return value.slice(0, 10)
}

/** Cobrança normalizada (somente dados financeiros; sem nome, e-mail, documento ou telefone do pagador). */
export type NormalizedPayment = {
  id: string
  customerId: string | null
  subscriptionId: string | null
  externalStatus: string
  state: NormalizedState
  deleted: boolean
  billingType: string | null
  valueCents: number
  netValueCents: number | null
  feeCents: number | null
  refundedCents: number
  dueDate: string
  paymentDate: string | null
  clientPaymentDate: string | null
  confirmedDate: string | null
  creditDate: string | null
  externalReference: string | null
}

/** Normaliza o objeto "payment" do Asaas (API ou webhook). Lança AsaasDataError em dado inconsistente. */
export function normalizePayment(raw: unknown, eventType?: string): NormalizedPayment {
  if (!raw || typeof raw !== 'object') throw new AsaasDataError('INVALID_PAYMENT')
  const p = raw as Record<string, unknown>
  if (typeof p.id !== 'string' || !PAYMENT_ID.test(p.id)) throw new AsaasDataError('INVALID_PAYMENT_ID')
  const subscriptionId = typeof p.subscription === 'string' && p.subscription ? p.subscription : null
  if (subscriptionId !== null && !SUBSCRIPTION_ID.test(subscriptionId)) throw new AsaasDataError('INVALID_SUBSCRIPTION_ID')
  const customerId = typeof p.customer === 'string' && CUSTOMER_ID.test(p.customer) ? p.customer : null
  const valueCents = asaasValueToCents(p.value)
  if (valueCents === 0) throw new AsaasDataError('INVALID_VALUE')
  const netValueCents = p.netValue === undefined || p.netValue === null ? null : asaasValueToCents(p.netValue, 'net_value')
  if (netValueCents !== null && netValueCents > valueCents) throw new AsaasDataError('INVALID_NET_VALUE')
  const refunds = Array.isArray(p.refunds) ? p.refunds : []
  let refundedCents = 0
  for (const r of refunds) {
    if (r && typeof r === 'object' && (r as { status?: unknown }).status !== 'CANCELLED') {
      refundedCents += asaasValueToCents((r as { value?: unknown }).value, 'refund_value')
    }
  }
  if (refundedCents > valueCents) throw new AsaasDataError('INVALID_REFUND_VALUE')
  const externalStatus = typeof p.status === 'string' ? p.status : 'UNKNOWN'
  const deleted = p.deleted === true || eventType === 'PAYMENT_DELETED'
  let state: NormalizedState = STATUS_MAP[externalStatus] ?? 'unknown'
  if (deleted) state = 'deleted'
  else if (eventType === 'PAYMENT_PARTIALLY_REFUNDED' || (refundedCents > 0 && refundedCents < valueCents && state === 'received')) state = 'partially_refunded'
  return {
    id: p.id, customerId, subscriptionId, externalStatus, state, deleted,
    billingType: typeof p.billingType === 'string' ? p.billingType.slice(0, 30) : null,
    valueCents, netValueCents, feeCents: netValueCents === null ? null : valueCents - netValueCents, refundedCents,
    dueDate: date(p.dueDate, 'due_date', true)!,
    paymentDate: date(p.paymentDate, 'payment_date'),
    clientPaymentDate: date(p.clientPaymentDate, 'client_payment_date'),
    confirmedDate: date(p.confirmedDate, 'confirmed_date'),
    creditDate: date(p.creditDate, 'credit_date'),
    externalReference: typeof p.externalReference === 'string' ? p.externalReference.slice(0, 100) : null,
  }
}

/** Assinatura normalizada (para comparação com o contrato do CRM antes do vínculo). */
export type NormalizedSubscription = {
  id: string; customerId: string | null; valueCents: number; cycle: AsaasCycle; nextDueDate: string | null
  externalStatus: string; deleted: boolean
}

export function normalizeSubscription(raw: unknown): NormalizedSubscription {
  if (!raw || typeof raw !== 'object') throw new AsaasDataError('INVALID_SUBSCRIPTION')
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || !SUBSCRIPTION_ID.test(s.id)) throw new AsaasDataError('INVALID_SUBSCRIPTION_ID')
  if (typeof s.cycle !== 'string' || !ASAAS_CYCLES.includes(s.cycle as AsaasCycle)) throw new AsaasDataError('INVALID_CYCLE')
  const valueCents = asaasValueToCents(s.value)
  if (valueCents === 0) throw new AsaasDataError('INVALID_VALUE')
  return {
    id: s.id, customerId: typeof s.customer === 'string' && CUSTOMER_ID.test(s.customer) ? s.customer : null,
    valueCents, cycle: s.cycle as AsaasCycle, nextDueDate: date(s.nextDueDate, 'next_due_date'),
    externalStatus: typeof s.status === 'string' ? s.status : 'UNKNOWN', deleted: s.deleted === true,
  }
}

/**
 * Interface do adaptador externo (SOMENTE LEITURA), para a Fase 2+. Nesta fase não há implementação: os serviços
 * recebem um objeto que cumpre este contrato (mock nos testes). Não há métodos de criação/alteração/cancelamento.
 */
export type AsaasReadGateway = {
  environment: AsaasEnvironment
  getPayment(paymentId: string): Promise<unknown>
  getSubscription(subscriptionId: string): Promise<unknown>
  listSubscriptionPayments(subscriptionId: string): Promise<unknown[]>
}
