/**
 * Fase 1.2 — regressão PURA dos riscos financeiros da auditoria 1.1 (P2-2, P2-4, P2-5, refunds). Dados sintéticos.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asaasDateTime, parseWebhookEvent } from './policy'
import { cashDateOf, decideReconciliation, matchPayment, resolveCompetence, STATE_RANK, type ReconcileInput } from './reconcile'
import { normalizePayment } from './types'

const PAY = (o: Record<string, unknown> = {}) => ({ id: 'pay_fix0000000000001', subscription: 'sub_fix0000000000001', value: 69.9, netValue: 68.91,
  status: 'PENDING', billingType: 'PIX', dueDate: '2026-11-30', ...o })
const NONE = { competenceMonth: null, originalDueDate: null, basis: null }

describe('P2-2 — competência original preservada', () => {
  it('novembro adiado para dezembro (vencimento original informado) → competência NOVEMBRO', () => {
    assert.deepEqual(resolveCompetence(normalizePayment(PAY({ dueDate: '2026-12-05', originalDueDate: '2026-11-30' })), NONE),
      { status: 'resolved', competenceMonth: '2026-11-01', basis: 'original_due_date', originalDueDate: '2026-11-30' })
  })
  it('sem alteração de vencimento → mês do vencimento', () => {
    assert.deepEqual(resolveCompetence(normalizePayment(PAY({ originalDueDate: '2026-11-30' })), NONE).status, 'resolved')
    assert.deepEqual(resolveCompetence(normalizePayment(PAY()), NONE),
      { status: 'resolved', competenceMonth: '2026-11-01', basis: 'due_date', originalDueDate: null })
  })
  it('ausência de vencimento original: só vincula se o vencimento for exatamente o previsto no CRM', () => {
    const entries = [{ id: 'e-nov', competenceMonth: '2026-11-01', dueDate: '2026-11-30', amountCents: 6990, status: 'open' as const },
      { id: 'e-dez', competenceMonth: '2026-12-01', dueDate: '2026-12-30', amountCents: 6990, status: 'open' as const }]
    assert.equal(matchPayment({ payment: normalizePayment(PAY()), hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() }).status, 'linked')
    // a cobrança de novembro movida para 05/12 sem o original: NUNCA vai para dezembro
    assert.deepEqual(matchPayment({ payment: normalizePayment(PAY({ dueDate: '2026-12-05' })), hasSubscriptionLink: true, entries, primaryLinkedPaymentByEntry: new Map() }),
      { status: 'review', competenceMonth: '2026-12-01', reason: 'COMPETENCE_UNCERTAIN', entryId: 'e-dez' })
  })
  it('informações contraditórias (vencimento original diferente do registrado) → revisão', () => {
    assert.deepEqual(resolveCompetence(normalizePayment(PAY({ originalDueDate: '2026-12-30' })), { competenceMonth: null, originalDueDate: '2026-11-30', basis: null }),
      { status: 'conflict', reason: 'COMPETENCE_CONFLICT' })
    assert.deepEqual(resolveCompetence(normalizePayment(PAY({ originalDueDate: '2026-12-30' })), { competenceMonth: '2026-11-01', originalDueDate: null, basis: 'due_date' }),
      { status: 'conflict', reason: 'COMPETENCE_CONFLICT' })
  })
  it('competência já registrada não muda quando o vencimento muda depois', () => {
    assert.deepEqual(resolveCompetence(normalizePayment(PAY({ dueDate: '2027-01-10' })), { competenceMonth: '2026-11-01', originalDueDate: null, basis: 'due_date' }),
      { status: 'resolved', competenceMonth: '2026-11-01', basis: 'due_date', originalDueDate: null })
  })
})

describe('P2-4 — datas de evento', () => {
  it('formato documentado ("AAAA-MM-DD HH:mm:ss", Brasília) → ISO', () => {
    assert.equal(asaasDateTime('2026-11-30 10:15:03'), '2026-11-30T13:15:03.000Z')
    assert.equal(asaasDateTime('2026-12-31 23:59:59'), '2027-01-01T02:59:59.000Z')
  })
  it('ausente, inválida ou em formato inesperado → não confiável (nunca vira "agora")', () => {
    for (const bad of [undefined, null, '', '2026-02-31 10:00:00', '2026-11-30 24:00:00', '2026-13-01 10:00:00', '30/11/2026 10:00:00',
      '2026-11-30T10:00:00', '2026-11-30 10:00', '2026-11-30 10:00:00Z', '2026-11-30 10:00:00-03:00', 1764508503, ' 2026-11-30 10:00:00']) {
      assert.equal(asaasDateTime(bad), null, String(bad))
    }
    const ev = parseWebhookEvent('sandbox', { id: 'evt_x1', event: 'PAYMENT_RECEIVED', dateCreated: '30/11/2026 10:00', payment: PAY() })
    assert.deepEqual([ev.dateTrusted, ev.eventCreatedAt], [false, null])
    assert.equal(parseWebhookEvent('sandbox', { id: 'evt_x2', event: 'PAYMENT_RECEIVED', payment: PAY() }).dateTrusted, false)
  })
  it('mesmo segundo: a situação só avança (CONFIRMED < RECEIVED < estornos)', () => {
    assert.ok(STATE_RANK.received > STATE_RANK.confirmed)
    assert.ok(STATE_RANK.refunded > STATE_RANK.received && STATE_RANK.chargeback > STATE_RANK.received)
    assert.ok(STATE_RANK.open < STATE_RANK.confirmed)
  })
})

describe('P2-5 — disponibilidade do dinheiro', () => {
  const base = (extra: Record<string, unknown>, today = '2026-11-30'): ReconcileInput => ({
    environment: 'sandbox', payment: normalizePayment(PAY({ status: 'RECEIVED', ...extra })), today,
    link: { status: 'linked', isAdditional: false, manualOverlapConfirmed: false },
    entry: { id: 'e', status: 'open', amountCents: 6990, settledCents: 0 }, linkedMovements: [], manualMovements: [],
  })
  it('confirmado sem crédito → nenhuma baixa', () => {
    assert.deepEqual(decideReconciliation({ ...base({}), payment: normalizePayment(PAY({ status: 'CONFIRMED', estimatedCreditDate: '2026-12-30' })) }),
      { type: 'none', reason: 'AWAITING_CREDIT' })
  })
  it('crédito futuro → aguarda; crédito hoje ou passado → baixa na data do crédito', () => {
    assert.deepEqual(decideReconciliation(base({ paymentDate: '2026-11-29', creditDate: '2026-12-01' })), { type: 'none', reason: 'AWAITING_CREDIT_DATE' })
    assert.equal((decideReconciliation(base({ paymentDate: '2026-11-29', creditDate: '2026-11-30' })) as { settledOn: string }).settledOn, '2026-11-30')
    assert.equal((decideReconciliation(base({ paymentDate: '2026-11-20', creditDate: '2026-11-21' })) as { settledOn: string }).settledOn, '2026-11-21')
    // reprocessamento depois que a data chega
    assert.equal(decideReconciliation(base({ paymentDate: '2026-11-29', creditDate: '2026-12-01' }, '2026-12-01')).type, 'record_receipt')
  })
  it('sem data de crédito: usa a prevista; sem ela, a do pagamento — e nunca uma data futura', () => {
    assert.equal(cashDateOf(normalizePayment(PAY({ paymentDate: '2026-11-29', estimatedCreditDate: '2026-11-30' }))), '2026-11-30')
    assert.deepEqual(decideReconciliation(base({ paymentDate: '2026-11-29', estimatedCreditDate: '2026-12-02' })), { type: 'none', reason: 'AWAITING_CREDIT_DATE' })
    assert.equal((decideReconciliation(base({ paymentDate: '2026-11-29' })) as { settledOn: string }).settledOn, '2026-11-29')
  })
})

describe('estornos (documentação oficial): só DONE conta como devolvido', () => {
  it('PENDING e CANCELLED não contam; DONE parcial = estorno parcial; soma DONE = total', () => {
    assert.equal(normalizePayment(PAY({ status: 'RECEIVED', refunds: [{ value: 20, status: 'PENDING' }] })).state, 'received')
    assert.equal(normalizePayment(PAY({ status: 'RECEIVED', refunds: [{ value: 20, status: 'CANCELLED' }] })).state, 'received')
    const partial = normalizePayment(PAY({ status: 'RECEIVED', refunds: [{ value: 20, status: 'DONE' }, { value: 30, status: 'PENDING' }] }))
    assert.deepEqual([partial.state, partial.refundedCents], ['partially_refunded', 2000])
    assert.equal(normalizePayment(PAY({ status: 'REFUNDED', refunds: [{ value: 30, status: 'DONE' }, { value: 39.9, status: 'DONE' }] })).refundedCents, 6990)
  })
})
