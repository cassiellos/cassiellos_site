/**
 * Integração Asaas — FASE 1: regras puras (sem banco, sem rede). Somente dados SINTÉTICOS (ids fictícios).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertNoPaidNotifications, buildCustomerPayload, canCreateExternalCharge, parseWebhookEvent, verifyWebhookToken } from './policy'
import {
  cashDateOf, compareSubscription, competenceOf, decideReconciliation, matchPayment, receiptIdempotencyKey,
  type ReconcileInput, type SourceForLink,
} from './reconcile'
import { asaasValueToCents, normalizePayment, normalizeSubscription } from './types'

const PAY = (o: Record<string, unknown> = {}) => ({
  id: 'pay_fict000000000001', customer: 'cus_fict000000000001', subscription: 'sub_fict000000000001', value: 69.9, netValue: 64.91,
  status: 'PENDING', billingType: 'PIX', dueDate: '2026-11-30', deleted: false, ...o,
})

describe('normalização de dados do Asaas', () => {
  it('reais → centavos exatos; recusa frações de centavo, negativos e não números', () => {
    assert.equal(asaasValueToCents(69.9), 6990)
    assert.equal(asaasValueToCents(0.1 + 0.2), 30)
    assert.equal(asaasValueToCents(1999.99), 199999)
    for (const bad of [-1, 10.005, NaN, Infinity, '69.90', null]) assert.throws(() => asaasValueToCents(bad), /INVALID_VALUE/, String(bad))
  })
  it('cobrança: bruto, líquido, tarifa e datas; sem dados pessoais', () => {
    const p = normalizePayment(PAY({ status: 'RECEIVED', paymentDate: '2026-11-29', creditDate: '2026-11-30', name: 'Pessoa', email: 'x@y.com', cpfCnpj: '00000000000' }))
    assert.deepEqual([p.valueCents, p.netValueCents, p.feeCents, p.state, p.dueDate, p.creditDate], [6990, 6491, 499, 'received', '2026-11-30', '2026-11-30'])
    assert.equal(JSON.stringify(p).includes('x@y.com'), false)
    assert.equal(JSON.stringify(p).includes('Pessoa'), false)
  })
  it('CONFIRMED (aprovado, sem dinheiro) ≠ RECEIVED (disponível)', () => {
    assert.equal(normalizePayment(PAY({ status: 'CONFIRMED' })).state, 'confirmed')
    for (const s of ['RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']) assert.equal(normalizePayment(PAY({ status: s })).state, 'received', s)
  })
  it('estados: vencida, estornos, chargeback, removida, desconhecida', () => {
    assert.equal(normalizePayment(PAY({ status: 'OVERDUE' })).state, 'overdue')
    assert.equal(normalizePayment(PAY({ status: 'REFUNDED' })).state, 'refunded')
    assert.equal(normalizePayment(PAY({ status: 'REFUND_REQUESTED' })).state, 'refund_pending')
    assert.equal(normalizePayment(PAY({ status: 'CHARGEBACK_REQUESTED' })).state, 'chargeback')
    assert.equal(normalizePayment(PAY({ status: 'RECEIVED', deleted: true })).state, 'deleted')
    assert.equal(normalizePayment(PAY({ status: 'PENDING' }), 'PAYMENT_DELETED').state, 'deleted')
    assert.equal(normalizePayment(PAY({ status: 'RECEIVED', refunds: [{ value: 20, status: 'DONE' }] })).state, 'partially_refunded')
    assert.equal(normalizePayment(PAY({ status: 'RECEIVED' }), 'PAYMENT_PARTIALLY_REFUNDED').state, 'partially_refunded')
    assert.equal(normalizePayment(PAY({ status: 'NOVO_STATUS' })).state, 'unknown')
  })
  it('dados inconsistentes são recusados (nunca gravados)', () => {
    for (const bad of [PAY({ id: 'x' }), PAY({ value: 0 }), PAY({ netValue: 80 }), PAY({ dueDate: undefined }), PAY({ subscription: 'abc' }),
      PAY({ refunds: [{ value: 100, status: 'DONE' }] }), null]) assert.throws(() => normalizePayment(bad))
  })
  it('assinatura: ciclo e valor', () => {
    const s = normalizeSubscription({ id: 'sub_fict000000000001', customer: 'cus_fict000000000001', value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-11-30', status: 'ACTIVE' })
    assert.deepEqual([s.valueCents, s.cycle, s.nextDueDate], [6990, 'MONTHLY', '2026-11-30'])
    assert.throws(() => normalizeSubscription({ id: 'sub_x1', value: 10, cycle: 'DAILY' }), /INVALID_CYCLE/)
  })
})

const SOURCE: SourceForLink = { direction: 'in', status: 'active', periodicity: 'monthly', amountCents: 6990, dueDay: 30, installmentPlan: false, billingProvider: 'manual' }
const SUB = normalizeSubscription({ id: 'sub_fict000000000001', value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-11-30', status: 'ACTIVE' })

describe('contrato ↔ assinatura', () => {
  it('compatível: nenhum bloqueio nem divergência', () => {
    assert.deepEqual(compareSubscription(SOURCE, SUB), { blocking: [], divergences: [] })
  })
  it('vencimento no fim do mês curto conta como o mesmo dia (31 → 30/11)', () => {
    assert.deepEqual(compareSubscription({ ...SOURCE, dueDay: 31 }, SUB).divergences, [])
  })
  it('valor e dia divergentes: vincula com sinalização', () => {
    assert.deepEqual(compareSubscription({ ...SOURCE, amountCents: 7990, dueDay: 10 }, SUB).divergences, ['VALUE_MISMATCH', 'DUE_DAY_MISMATCH'])
  })
  it('ciclo incompatível, despesa, projeto parcelado, encerrado ou cobrado pelo CRM: bloqueia', () => {
    assert.deepEqual(compareSubscription({ ...SOURCE, periodicity: 'annual' }, SUB).blocking, ['CYCLE_MISMATCH'])
    assert.ok(compareSubscription({ ...SOURCE, direction: 'out' }, SUB).blocking.includes('SOURCE_NOT_REVENUE'))
    assert.ok(compareSubscription({ ...SOURCE, installmentPlan: true }, SUB).blocking.includes('SOURCE_INSTALLMENT_PLAN'))
    assert.ok(compareSubscription({ ...SOURCE, status: 'ended' }, SUB).blocking.includes('SOURCE_ENDED'))
    assert.ok(compareSubscription({ ...SOURCE, billingProvider: 'asaas_charge' }, SUB).blocking.includes('SOURCE_BILLED_BY_CRM'))
  })
})

describe('cobrança ↔ competência', () => {
  const p = normalizePayment(PAY())
  const entries = [{ id: 'e-out', competenceMonth: '2026-10-01', dueDate: '2026-10-30', amountCents: 6990, status: 'open' as const },
    { id: 'e-nov', competenceMonth: '2026-11-01', dueDate: '2026-11-30', amountCents: 6990, status: 'open' as const }]
  it('competência = mês do vencimento', () => assert.equal(competenceOf(p), '2026-11-01'))
  it('uma competência, uma cobrança principal', () => {
    assert.deepEqual(matchPayment({ payment: p, hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() }),
      { status: 'linked', entryId: 'e-nov', competenceMonth: '2026-11-01', basis: 'due_date', divergences: [] })
    // a mesma cobrança de novo: continua ligada (idempotente)
    assert.equal(matchPayment({ payment: p, hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map([['e-nov', p.id]]) }).status, 'linked')
  })
  it('segunda cobrança na mesma competência → revisão (nunca dois vínculos principais)', () => {
    const r = matchPayment({ payment: p, hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map([['e-nov', 'pay_outra']]) })
    assert.deepEqual(r, { status: 'review', competenceMonth: '2026-11-01', reason: 'DUPLICATE_COMPETENCE', entryId: 'e-nov' })
  })
  it('sem assinatura vinculada ou competência ainda não gerada → não vincula', () => {
    assert.equal((matchPayment({ payment: p, hasSubscriptionLink: false, entries, primaryLinkedPaymentByEntry: new Map() }) as { reason: string }).reason, 'NO_SUBSCRIPTION_LINK')
    assert.equal((matchPayment({ payment: normalizePayment(PAY({ dueDate: '2027-05-30' })), hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() }) as { reason: string }).reason, 'ENTRY_NOT_GENERATED')
  })
  it('valor e vencimento divergentes ficam sinalizados (vencimento original informado)', () => {
    const r = matchPayment({ payment: normalizePayment(PAY({ value: 79.9, dueDate: '2026-11-28', originalDueDate: '2026-11-30' })), hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() })
    assert.deepEqual(r.status === 'linked' && [r.basis, r.divergences], ['original_due_date', ['AMOUNT_MISMATCH', 'DUE_DATE_MISMATCH']])
  })
  it('vencimento diferente do previsto e SEM vencimento original → revisão (nunca adivinha a competência)', () => {
    const r = matchPayment({ payment: normalizePayment(PAY({ dueDate: '2026-11-28' })), hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() })
    assert.deepEqual(r, { status: 'review', competenceMonth: '2026-11-01', reason: 'COMPETENCE_UNCERTAIN', entryId: 'e-nov' })
  })
})

describe('decisão de conciliação', () => {
  const base = (o: Partial<ReconcileInput> & { status?: string; extra?: Record<string, unknown> } = {}): ReconcileInput => ({
    environment: 'sandbox',
    payment: normalizePayment(PAY({ status: o.status ?? 'RECEIVED', paymentDate: '2026-11-29', creditDate: '2026-12-01', ...(o.extra ?? {}) })),
    link: { status: 'linked', isAdditional: false, manualOverlapConfirmed: false },
    entry: { id: 'e-nov', status: 'open', amountCents: 6990, settledCents: 0 },
    linkedMovements: [], manualMovements: [], today: '2026-12-15', ...o,
  })
  it('recebido → baixa do valor BRUTO na data de CAIXA (dinheiro disponível), chave determinística', () => {
    const a = decideReconciliation(base())
    assert.deepEqual(a, { type: 'record_receipt', amountCents: 6990, settledOn: '2026-12-01', idempotencyKey: receiptIdempotencyKey('sandbox', 'pay_fict000000000001') })
  })
  it('chave de idempotência: estável, formato UUID, separada por ambiente e por cobrança', () => {
    const k = receiptIdempotencyKey('sandbox', 'pay_a')
    assert.equal(k, receiptIdempotencyKey('sandbox', 'pay_a'))
    assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.notEqual(k, receiptIdempotencyKey('production', 'pay_a'))
    assert.notEqual(k, receiptIdempotencyKey('sandbox', 'pay_b'))
  })
  it('evento repetido depois da baixa: nada a fazer', () => {
    assert.deepEqual(decideReconciliation(base({ linkedMovements: [{ id: 's1', amountCents: 6990, reversed: false }] })), { type: 'none', reason: 'ALREADY_SETTLED' })
  })
  it('confirmado (sem dinheiro disponível) não gera baixa', () => {
    assert.deepEqual(decideReconciliation(base({ status: 'CONFIRMED' })), { type: 'none', reason: 'AWAITING_CREDIT' })
  })
  it('baixa manual já existente → revisão; confirmada pelo administrador → só vincula (nenhuma baixa nova)', () => {
    const manual = [{ id: 'm1', amountCents: 6990, reversed: false }]
    assert.deepEqual(decideReconciliation(base({ manualMovements: manual })), { type: 'review', code: 'MANUAL_SETTLEMENT_EXISTS' })
    assert.deepEqual(decideReconciliation(base({ manualMovements: manual, link: { status: 'linked', isAdditional: false, manualOverlapConfirmed: true } })),
      { type: 'link_manual', settlementId: 'm1' })
    assert.deepEqual(decideReconciliation(base({ manualMovements: [...manual, { id: 'm2', amountCents: 6990, reversed: false }],
      link: { status: 'linked', isAdditional: false, manualOverlapConfirmed: true } })), { type: 'review', code: 'MANUAL_SETTLEMENT_AMBIGUOUS' })
  })
  it('valor divergente → revisão; aceito com justificativa ou cobrança adicional → baixa limitada ao saldo', () => {
    const partial = base({ extra: { value: 30, netValue: 28.5 }, entry: { id: 'e', status: 'open', amountCents: 6990, settledCents: 0 } })
    assert.deepEqual(decideReconciliation(partial), { type: 'review', code: 'AMOUNT_MISMATCH' })
    assert.equal(decideReconciliation({ ...partial, link: { ...partial.link, divergenceAccepted: true } }).type, 'record_receipt')
    assert.deepEqual(decideReconciliation({ ...partial, link: { ...partial.link, isAdditional: true }, entry: { id: 'e', status: 'open', amountCents: 6990, settledCents: 6990 } }),
      { type: 'review', code: 'AMOUNT_EXCEEDS_BALANCE' })
  })
  it('estorno total → estorna os recibos (histórico preservado); parcial e chargeback → revisão', () => {
    const mov = [{ id: 's1', amountCents: 6990, reversed: false }]
    assert.deepEqual(decideReconciliation(base({ status: 'REFUNDED', linkedMovements: mov })), { type: 'reverse', settlementIds: ['s1'], reason: 'ASAAS_REFUNDED' })
    assert.deepEqual(decideReconciliation(base({ status: 'REFUNDED', linkedMovements: [{ ...mov[0], reversed: true }] })), { type: 'none', reason: 'NOTHING_TO_REVERSE' })
    assert.deepEqual(decideReconciliation(base({ extra: { refunds: [{ value: 10, status: 'DONE' }] }, linkedMovements: mov })), { type: 'review', code: 'PARTIAL_REFUND' })
    assert.deepEqual(decideReconciliation(base({ status: 'CHARGEBACK_REQUESTED', linkedMovements: mov })), { type: 'review', code: 'CHARGEBACK' })
  })
  it('removida/vencida/pendente após recibo → revisão; sem recibo → nada (lançamento intacto)', () => {
    const mov = [{ id: 's1', amountCents: 6990, reversed: false }]
    assert.deepEqual(decideReconciliation(base({ extra: { deleted: true }, linkedMovements: mov })), { type: 'review', code: 'DELETED_AFTER_RECEIPT' })
    assert.deepEqual(decideReconciliation(base({ extra: { deleted: true } })), { type: 'none', reason: 'DELETED' })
    assert.deepEqual(decideReconciliation(base({ status: 'PENDING', linkedMovements: mov })), { type: 'review', code: 'RECEIPT_UNDONE' })
    assert.deepEqual(decideReconciliation(base({ status: 'OVERDUE' })), { type: 'none', reason: 'AWAITING_PAYMENT' })
  })
  it('recebido de novo depois de estornado → revisão (nunca segunda baixa automática)', () => {
    assert.deepEqual(decideReconciliation(base({ linkedMovements: [{ id: 's1', amountCents: 6990, reversed: true }] })), { type: 'review', code: 'RECEIVED_AFTER_REVERSAL' })
  })
  it('sem vínculo, sem lançamento ou lançamento cancelado: nunca baixa', () => {
    assert.equal(decideReconciliation(base({ link: { status: 'review', isAdditional: false, manualOverlapConfirmed: false } })).type, 'none')
    assert.deepEqual(decideReconciliation(base({ entry: null })), { type: 'review', code: 'ENTRY_MISSING' })
    assert.deepEqual(decideReconciliation(base({ entry: { id: 'e', status: 'cancelled', amountCents: 6990, settledCents: 0 } })), { type: 'review', code: 'ENTRY_CANCELLED' })
  })
  it('data de caixa: crédito; na falta, pagamento', () => {
    assert.equal(cashDateOf(normalizePayment(PAY({ paymentDate: '2026-11-29' }))), '2026-11-29')
    assert.deepEqual(decideReconciliation(base({ extra: { paymentDate: null, creditDate: null } })), { type: 'review', code: 'MISSING_PAYMENT_DATE' })
  })
})

describe('políticas: zero notificações pagas, cobranças externas e webhook', () => {
  it('cliente novo sempre com notificationDisabled: true e sem canal de contato', () => {
    const p = buildCustomerPayload({ name: ' Cliente Fictício ', cpfCnpj: '000.000.000-00', externalReference: '11111111-2222-4333-8444-555555555555' })
    assert.deepEqual(p, { name: 'Cliente Fictício', cpfCnpj: '00000000000', externalReference: '11111111-2222-4333-8444-555555555555', notificationDisabled: true })
  })
  it('qualquer carga que ligue notificação ou canal pago é recusada', () => {
    for (const bad of [{ notificationDisabled: false }, { enabled: true }, { smsEnabledForCustomer: true }, { whatsappEnabledForCustomer: true },
      { phoneCallEnabledForCustomer: true }, { postalService: true }, { nested: { smsEnabledForProvider: true } }]) {
      assert.throws(() => assertNoPaidNotifications(bad), /FORBIDDEN|MUST_BE_DISABLED/, JSON.stringify(bad))
    }
    assert.doesNotThrow(() => assertNoPaidNotifications({ enabled: false, smsEnabledForCustomer: false }))
  })
  it('assinatura externa nunca recebe cobrança criada pelo CRM; competência já cobrada também não', () => {
    assert.deepEqual(canCreateExternalCharge({ billingProvider: 'asaas_subscription', existingPaymentsForCompetence: 0 }), { allowed: false, reason: 'MANAGED_BY_EXTERNAL_SUBSCRIPTION' })
    assert.deepEqual(canCreateExternalCharge({ billingProvider: 'manual', existingPaymentsForCompetence: 0 }), { allowed: false, reason: 'CONTRACT_NOT_BILLED_BY_ASAAS' })
    assert.deepEqual(canCreateExternalCharge({ billingProvider: 'asaas_charge', existingPaymentsForCompetence: 1 }), { allowed: false, reason: 'COMPETENCE_ALREADY_HAS_CHARGE' })
    assert.deepEqual(canCreateExternalCharge({ billingProvider: 'asaas_charge', existingPaymentsForCompetence: 0 }), { allowed: true })
  })
  it('token do webhook: comparação exata, segredo fraco ou ausente recusa', () => {
    const secret = 'segredo-sintetico-de-teste-0123456789abcdef'
    assert.equal(verifyWebhookToken(secret, secret), true)
    for (const [r, e] of [[secret + 'x', secret], ['', secret], [null, secret], [secret, ''], ['curto', 'curto'], [secret, undefined]] as const) {
      assert.equal(verifyWebhookToken(r as string | null, e as string | undefined), false)
    }
  })
  it('evento: ambiente explícito, id e tipo validados, payload mínimo SEM dados pessoais', () => {
    const ev = parseWebhookEvent('sandbox', { id: 'evt_fict_001', event: 'PAYMENT_RECEIVED', dateCreated: '2026-11-30 10:15:00',
      payment: PAY({ status: 'RECEIVED', paymentDate: '2026-11-30', name: 'Pessoa', email: 'x@y.com', cpfCnpj: '98765432100', phone: '31999999999' }) })
    assert.equal(ev.eventCreatedAt, '2026-11-30T13:15:00.000Z')
    assert.equal(ev.payment?.state, 'received')
    const stored = JSON.stringify(ev.paymentMin)
    for (const pii of ['Pessoa', 'x@y.com', '98765432100', '31999999999']) assert.equal(stored.includes(pii), false, pii)
    assert.throws(() => parseWebhookEvent('staging', { id: 'evt_1', event: 'PAYMENT_RECEIVED' }), /INVALID_ENVIRONMENT/)
    assert.throws(() => parseWebhookEvent('sandbox', { id: 'x', event: 'PAYMENT_RECEIVED' }), /INVALID_EVENT_ID/)
    assert.equal(parseWebhookEvent('production', { id: 'evt_sub_1', event: 'SUBSCRIPTION_UPDATED' }).payment, null)
  })
})
