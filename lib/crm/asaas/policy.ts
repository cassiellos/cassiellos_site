import { createHash, timingSafeEqual } from 'node:crypto'
import { AsaasDataError, isAsaasEnvironment, normalizePayment, PAYMENT_ID, type AsaasEnvironment, type NormalizedPayment } from './types'

/**
 * Políticas da integração Asaas (puras, sem rede):
 *  1. ZERO notificações pagas — clientes criados pela integração sempre com notificationDisabled: true; nenhuma
 *     carga útil pode ligar SMS, WhatsApp, voz ou Correios.
 *  2. Assinatura externa nunca recebe cobrança criada pelo CRM.
 *  3. Webhook: autenticidade por token em tempo constante, ambiente explícito, payload mínimo (sem dados pessoais).
 */

// ───────────────────────── 1. notificações ─────────────────────────

/** Campos que ligariam canais com custo (ou qualquer notificação) — proibidos em qualquer carga útil do CRM. */
const PAID_NOTIFICATION_KEYS = ['smsEnabledForCustomer', 'smsEnabledForProvider', 'whatsappEnabledForCustomer',
  'whatsappEnabledForProvider', 'phoneCallEnabledForCustomer', 'postalService', 'emailEnabledForCustomer']

export class AsaasPolicyError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AsaasPolicyError' }
}

export type CustomerDraft = { name: string; cpfCnpj: string; externalReference: string }

/**
 * Carga útil para um cliente NOVO no Asaas (uso futuro, Fase 2+). Sempre notificationDisabled: true — o link de
 * pagamento é enviado manualmente pelo CRM ("Copiar link de pagamento"). Sem e-mail/telefone: o Asaas não terá
 * canal para avisar o cliente. Não envia nada: só monta o objeto.
 */
export function buildCustomerPayload(d: CustomerDraft): Record<string, unknown> {
  const name = d.name.trim()
  const doc = d.cpfCnpj.replace(/\D/g, '')
  if (name.length < 2 || name.length > 160) throw new AsaasPolicyError('INVALID_NAME')
  if (doc.length !== 11 && doc.length !== 14) throw new AsaasPolicyError('INVALID_CPF_CNPJ')
  if (!/^[0-9a-f-]{36}$/i.test(d.externalReference)) throw new AsaasPolicyError('INVALID_EXTERNAL_REFERENCE')
  const payload = { name, cpfCnpj: doc, externalReference: d.externalReference, notificationDisabled: true }
  assertNoPaidNotifications(payload)
  return payload
}

/** Barreira final antes de qualquer envio futuro ao Asaas: recusa notificações ligadas ou canais pagos. */
export function assertNoPaidNotifications(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as Record<string, unknown>
  if ('notificationDisabled' in p && p.notificationDisabled !== true) throw new AsaasPolicyError('NOTIFICATIONS_MUST_BE_DISABLED')
  if ('enabled' in p && p.enabled === true) throw new AsaasPolicyError('NOTIFICATION_ENABLE_FORBIDDEN')
  for (const key of PAID_NOTIFICATION_KEYS) if (p[key] === true) throw new AsaasPolicyError('PAID_NOTIFICATION_FORBIDDEN')
  for (const value of Object.values(p)) if (value && typeof value === 'object') assertNoPaidNotifications(value)
}

// ───────────────────────── 2. cobranças externas ─────────────────────────

export type ChargeGuardInput = {
  billingProvider: 'manual' | 'asaas_subscription' | 'asaas_charge'
  /** Cobranças Asaas já conhecidas (não removidas) para a competência pretendida. */
  existingPaymentsForCompetence: number
}

/**
 * Trava para QUALQUER futura criação de cobrança no Asaas pelo CRM. Nesta fase nenhuma criação existe; a trava já
 * fica pronta e testada: contrato com assinatura externa nunca recebe cobrança do CRM, e competência que já tem
 * cobrança externa não recebe outra.
 */
export function canCreateExternalCharge(input: ChargeGuardInput): { allowed: true } | { allowed: false; reason: string } {
  if (input.billingProvider === 'asaas_subscription') return { allowed: false, reason: 'MANAGED_BY_EXTERNAL_SUBSCRIPTION' }
  if (input.billingProvider !== 'asaas_charge') return { allowed: false, reason: 'CONTRACT_NOT_BILLED_BY_ASAAS' }
  if (input.existingPaymentsForCompetence > 0) return { allowed: false, reason: 'COMPETENCE_ALREADY_HAS_CHARGE' }
  return { allowed: true }
}

// ───────────────────────── 3. webhook ─────────────────────────

/** Compara o cabeçalho asaas-access-token com o segredo esperado, em tempo constante. Segredo fraco = recusa. */
export function verifyWebhookToken(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || expected.length < 32 || typeof received !== 'string' || received.length > 512) return false
  const a = createHash('sha256').update(received).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) && received.length === expected.length
}

export type ParsedWebhookEvent = {
  environment: AsaasEnvironment
  eventId: string
  eventType: string
  eventCreatedAt: string | null
  /** Presente nos eventos de cobrança: só campos financeiros (o "payload mínimo" guardado). */
  payment: NormalizedPayment | null
  paymentMin: Record<string, unknown> | null
}

const EVENT_ID = /^evt_[A-Za-z0-9_-]{1,100}$/
const EVENT_TYPE = /^[A-Z][A-Z_]{2,79}$/
/** Campos do objeto payment que podem ser guardados (nenhum dado pessoal do pagador). */
const PAYMENT_MIN_KEYS = ['id', 'customer', 'subscription', 'value', 'netValue', 'status', 'billingType', 'dueDate', 'originalDueDate',
  'paymentDate', 'clientPaymentDate', 'confirmedDate', 'creditDate', 'estimatedCreditDate', 'deleted', 'externalReference', 'refunds']

/** "AAAA-MM-DD HH:mm:ss" do Asaas (horário de Brasília) → ISO. */
function asaasDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value)
  if (!m) return null
  const d = new Date(m[1] + 'T' + m[2] + '-03:00')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Lê o corpo do webhook (já autenticado). Guarda só o mínimo: id/tipo/data do evento e os campos financeiros da
 * cobrança — sem nome, e-mail, CPF/CNPJ, telefone ou endereço.
 */
export function parseWebhookEvent(environment: unknown, body: unknown): ParsedWebhookEvent {
  if (!isAsaasEnvironment(environment)) throw new AsaasDataError('INVALID_ENVIRONMENT')
  if (!body || typeof body !== 'object') throw new AsaasDataError('INVALID_EVENT')
  const b = body as Record<string, unknown>
  if (typeof b.id !== 'string' || !EVENT_ID.test(b.id)) throw new AsaasDataError('INVALID_EVENT_ID')
  if (typeof b.event !== 'string' || !EVENT_TYPE.test(b.event)) throw new AsaasDataError('INVALID_EVENT_TYPE')
  let payment: NormalizedPayment | null = null
  let paymentMin: Record<string, unknown> | null = null
  if (b.payment !== undefined && b.payment !== null) {
    if (typeof b.payment !== 'object' || typeof (b.payment as { id?: unknown }).id !== 'string' || !PAYMENT_ID.test((b.payment as { id: string }).id)) {
      throw new AsaasDataError('INVALID_PAYMENT_ID')
    }
    const raw = b.payment as Record<string, unknown>
    paymentMin = Object.fromEntries(PAYMENT_MIN_KEYS.filter(k => k in raw).map(k => [k,
      k === 'refunds' && Array.isArray(raw.refunds) ? raw.refunds.map(r => ({ value: (r as { value?: unknown })?.value, status: (r as { status?: unknown })?.status })) : raw[k]]))
    payment = normalizePayment(paymentMin, b.event)
  }
  return { environment, eventId: b.id, eventType: b.event, eventCreatedAt: asaasDateTime(b.dateCreated), payment, paymentMin }
}
