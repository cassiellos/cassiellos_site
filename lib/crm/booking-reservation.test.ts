import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTIVE_APPOINTMENT_STATUSES, BOOKING_LEAD_LOCK_NAMESPACE, COUNTED_BOOKING_STATUSES, DEFAULT_BOOKING_LIMITS,
  canonicalMailbox, parseLimitExemptMailboxes,
} from './booking-reservation'

describe('regras de reagendamento — constantes', () => {
  it('somente pending/confirmed ocupam o contato (e apenas até o término)', () => {
    assert.deepEqual([...ACTIVE_APPOINTMENT_STATUSES], ['pending', 'confirmed'])
    for (const freed of ['completed', 'cancelled', 'no_show', 'rescheduled']) {
      assert.equal(ACTIVE_APPOINTMENT_STATUSES.includes(freed), false, freed + ' deve liberar novo agendamento')
    }
  })

  it('trava por caixa de e-mail usa namespace próprio (diferente da trava do formulário)', () => {
    assert.equal(BOOKING_LEAD_LOCK_NAMESPACE, 241025)
    assert.notEqual(BOOKING_LEAD_LOCK_NAMESPACE, 241023)
  })

  it('limite antiabuso: 3 agendamentos por e-mail em 30 dias; falhas antes do Google não contam', () => {
    assert.deepEqual({ ...DEFAULT_BOOKING_LIMITS }, { maxBookingsPerMailbox: 3, windowDays: 30 })
    assert.deepEqual([...COUNTED_BOOKING_STATUSES], ['processing', 'confirmed'])
  })
})

describe('canonicalMailbox — normalização antiabuso do e-mail', () => {
  it('maiúsculas e espaços', () => {
    assert.equal(canonicalMailbox('  Maria.Souza@Clinica.COM.br '), 'maria.souza@clinica.com.br')
  })
  it('remove +sufixo em qualquer provedor', () => {
    assert.equal(canonicalMailbox('maria+teste@clinica.com.br'), 'maria@clinica.com.br')
    assert.equal(canonicalMailbox('maria+a+b@outlook.com'), 'maria@outlook.com')
  })
  it('Gmail: ignora pontos e unifica googlemail.com', () => {
    assert.equal(canonicalMailbox('Maria.Souza+promo@gmail.com'), 'mariasouza@gmail.com')
    assert.equal(canonicalMailbox('m.a.r.i.a.souza@googlemail.com'), 'mariasouza@gmail.com')
  })
  it('fora do Gmail os pontos são preservados (são caixas diferentes)', () => {
    assert.notEqual(canonicalMailbox('maria.souza@clinica.com.br'), canonicalMailbox('mariasouza@clinica.com.br'))
  })
  it('não confunde domínios diferentes', () => {
    assert.notEqual(canonicalMailbox('maria@gmail.com.br'), canonicalMailbox('maria@gmail.com'))
  })
})

describe('parseLimitExemptMailboxes — isenção administrativa do limite de 30 dias', () => {
  it('vazio por padrão', () => {
    assert.deepEqual(parseLimitExemptMailboxes(''), [])
    assert.deepEqual(parseLimitExemptMailboxes(undefined), [])
  })
  it('normaliza e ignora entradas inválidas', () => {
    assert.deepEqual(parseLimitExemptMailboxes(' Teste+1@Gmail.com , invalido, outra@clinica.com.br '),
      ['teste@gmail.com', 'outra@clinica.com.br'])
  })
})
