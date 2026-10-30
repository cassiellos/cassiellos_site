import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleMarketingConsentChange } from './booking-consent-request'
import type { ConnectablePool } from './booking-reservation'

const untouchedPool = {
  connect: async () => { throw new Error('o banco não deveria ser consultado') },
} as unknown as ConnectablePool

describe('POST /api/booking/consent — validações antes do banco', () => {
  it('sem sessão de agendamento válida: 401 e nada é gravado', async () => {
    const r = await handleMarketingConsentChange({ pool: untouchedPool, verifySession: () => null },
      { bookingToken: 'forjado', marketing: false })
    assert.deepEqual(r, { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } })
  })
  it('escolha que não seja true/false: 400', async () => {
    const session = { leadId: '00000000-0000-4000-8000-000000000001', submissionId: 'x', formSlug: 'odontologia' }
    for (const marketing of ['false', 0, null, undefined, { consent: false }]) {
      const r = await handleMarketingConsentChange({ pool: untouchedPool, verifySession: () => session },
        { bookingToken: 'ok', marketing })
      assert.deepEqual(r, { status: 400, body: { error: 'INVALID_REQUEST' } })
    }
  })
  it('falha do banco: 503 genérico (sem detalhes internos)', async () => {
    const session = { leadId: '00000000-0000-4000-8000-000000000001', submissionId: 'x', formSlug: 'odontologia' }
    const r = await handleMarketingConsentChange({ pool: untouchedPool, verifySession: () => session },
      { bookingToken: 'ok', marketing: false })
    assert.deepEqual(r, { status: 503, body: { error: 'CONSENT_UNAVAILABLE' } })
  })
})
