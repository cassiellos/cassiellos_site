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

describe('canonicalMailbox — regras seguras e documentadas por provedor (Fase 3.4)', () => {
  it('sempre: só minúsculas e espaços', () => {
    assert.equal(canonicalMailbox('  Maria.Souza@Clinica.COM.br '), 'maria.souza@clinica.com.br')
  })
  it('Gmail: ignora +sufixo e pontos, sem trocar o domínio', () => {
    assert.equal(canonicalMailbox('Maria.Souza+promo@gmail.com'), 'mariasouza@gmail.com')
    assert.equal(canonicalMailbox('m.a.r.i.a.souza+x@googlemail.com'), 'mariasouza@googlemail.com')
    assert.notEqual(canonicalMailbox('maria@googlemail.com'), canonicalMailbox('maria@gmail.com'), 'domínios não são unificados')
  })
  it('Proton: ignora +sufixo, ".", "_" e "-" (documentado como transparente)', () => {
    assert.equal(canonicalMailbox('maria.so_u-za+news@proton.me'), 'mariasouza@proton.me')
    assert.equal(canonicalMailbox('Maria+x@PM.me'), 'maria@pm.me')
  })
  it('Fastmail: ignora apenas +sufixo', () => {
    assert.equal(canonicalMailbox('maria.souza+loja@fastmail.com'), 'maria.souza@fastmail.com')
  })
  it('demais provedores e domínios corporativos: +sufixo e pontos PRESERVADOS (contatos diferentes)', () => {
    for (const email of ['maria+teste@clinica.com.br', 'maria+a@outlook.com', 'maria+a@hotmail.com',
      'maria+a@icloud.com', 'maria-a@yahoo.com', 'maria+a@empresa-no-google-workspace.com']) {
      assert.equal(canonicalMailbox(email), email, email)
    }
    assert.notEqual(canonicalMailbox('maria.souza@clinica.com.br'), canonicalMailbox('mariasouza@clinica.com.br'))
    assert.notEqual(canonicalMailbox('maria+1@outlook.com'), canonicalMailbox('maria@outlook.com'))
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
    assert.deepEqual(parseLimitExemptMailboxes(' Teste+1@Gmail.com , invalido, outra+x@clinica.com.br '),
      ['teste@gmail.com', 'outra+x@clinica.com.br'])
  })
})
