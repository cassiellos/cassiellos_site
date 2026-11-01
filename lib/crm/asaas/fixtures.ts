/**
 * Respostas e eventos SINTÉTICOS do Asaas para testes locais (Fase 2.2A). Formato baseado na documentação pública
 * da API v3; ids, nomes, documentos e valores são fictícios. Não corresponde a nenhum cliente real.
 *
 * Alguns objetos trazem de propósito campos com "dados pessoais" fictícios (nome, e-mail, documento, telefone,
 * descrição) para provar que eles NÃO são guardados nem registrados.
 */

export const FAKE_SANDBOX_KEY = '$aact_hmlg_000000000000000000000000FICTICIA0000000000'
export const FAKE_PRODUCTION_KEY = '$aact_prod_000000000000000000000000FICTICIA0000000000'
export const FAKE_WEBHOOK_TOKEN = 'token-ficticio-de-webhook-local-0123456789abcdef'

export const FAKE_PII = {
  name: 'Fulana Fictícia da Silva', email: 'fulana.ficticia@example.invalid', cpfCnpj: '00000000000', mobilePhone: '00000000000',
  address: 'Rua Fictícia, 0',
}

export function customerFixture(id: string, o: Record<string, unknown> = {}) {
  return { object: 'customer', id, dateCreated: '2026-10-01', externalReference: null, notificationDisabled: true, deleted: false, ...FAKE_PII, ...o }
}

export function subscriptionFixture(id: string, o: Record<string, unknown> = {}) {
  return { object: 'subscription', id, customer: 'cus_ficticio000000001', value: 69.9, cycle: 'MONTHLY', billingType: 'PIX',
    nextDueDate: '2026-11-30', status: 'ACTIVE', deleted: false, description: 'Hospedagem fictícia', ...o }
}

export function paymentFixture(id: string, subscription: string | null, o: Record<string, unknown> = {}) {
  return { object: 'payment', id, customer: 'cus_ficticio000000001', subscription, value: 69.9, netValue: 68.91, status: 'PENDING',
    billingType: 'PIX', dueDate: '2026-11-30', originalDueDate: '2026-11-30', paymentDate: null, clientPaymentDate: null, creditDate: null,
    estimatedCreditDate: null, confirmedDate: null, deleted: false, refunds: null, externalReference: null,
    description: 'Cobrança de ' + FAKE_PII.name, invoiceUrl: 'https://example.invalid/i/ficticia', ...o }
}

export const listFixture = (data: unknown[], hasMore = false, offset = 0) =>
  ({ object: 'list', hasMore, totalCount: data.length + offset + (hasMore ? 1 : 0), limit: 100, offset, data })

export const errorFixture = (code: string) => ({ errors: [{ code, description: 'Descrição com ' + FAKE_PII.email }] })

/** Evento de webhook sintético (formato documentado: dateCreated "AAAA-MM-DD HH:mm:ss"). */
export function webhookEvent(eventId: string, event: string, payment: Record<string, unknown> | null, dateCreated = '2026-11-30 10:00:00') {
  return { id: eventId, event, dateCreated, ...(payment ? { payment } : {}) }
}
