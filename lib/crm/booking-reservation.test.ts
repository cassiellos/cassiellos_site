import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACTIVE_APPOINTMENT_STATUSES, BOOKING_LEAD_LOCK_NAMESPACE } from './booking-reservation'

describe('regras de reagendamento — constantes', () => {
  it('somente pending/confirmed ocupam o contato (e apenas até o término)', () => {
    assert.deepEqual([...ACTIVE_APPOINTMENT_STATUSES], ['pending', 'confirmed'])
    for (const freed of ['completed', 'cancelled', 'no_show', 'rescheduled']) {
      assert.equal(ACTIVE_APPOINTMENT_STATUSES.includes(freed), false, freed + ' deve liberar novo agendamento')
    }
  })

  it('trava por lead usa namespace próprio (diferente da trava por e-mail do formulário)', () => {
    assert.equal(BOOKING_LEAD_LOCK_NAMESPACE, 241025)
    assert.notEqual(BOOKING_LEAD_LOCK_NAMESPACE, 241023)
  })
})
