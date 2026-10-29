import type { BookingSession } from './booking-confirmation'
import type { HandlerResponse } from './booking-intake-request'
import type { ConnectablePool } from './booking-reservation'
import { changeMarketingConsent } from './marketing-consent'

/**
 * POST /api/booking/consent — mudança de "Preferências de cookies" feita com a página do
 * agendamento aberta, DEPOIS do envio do formulário (sem dependências de framework).
 *
 * - O vínculo com o cadastro vem só da sessão de agendamento assinada (emitida após o
 *   cadastro verificado pelo Turnstile); nenhum dado pessoal trafega aqui.
 * - Recusa/revogação: registra no CRM de forma auditável (consents + linha do tempo).
 * - Aceite: registra a nova autorização dada pelo próprio visitante no aviso.
 * - Nunca altera o cadastro, reuniões ou contratos; respostas não revelam dados.
 */

export type ConsentChangeDeps = {
  pool: ConnectablePool
  verifySession: (token: unknown) => BookingSession | null
}

export async function handleMarketingConsentChange(
  deps: ConsentChangeDeps,
  input: { bookingToken: unknown; marketing: unknown },
): Promise<HandlerResponse> {
  const session = deps.verifySession(input.bookingToken)
  if (!session) return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
  if (typeof input.marketing !== 'boolean') return { status: 400, body: { error: 'INVALID_REQUEST' } }
  try {
    const result = await changeMarketingConsent(deps.pool, {
      leadId: session.leadId, granted: input.marketing, source: 'visitor_preferences',
    })
    if (result.outcome === 'not_found') return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
    if (result.outcome === 'not_allowed') return { status: 400, body: { error: 'INVALID_REQUEST' } }
    return { status: 200, body: { ok: true } }
  } catch {
    return { status: 503, body: { error: 'CONSENT_UNAVAILABLE' } }
  }
}
