import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyNewLeadAsTest,
  getCrmBookingMode,
  isMetaDispatchAllowed,
  isTestEmail,
  isTestEmailDomain,
  parseTestEmails,
} from './booking-mode'

// Endereços usados aqui NUNCA pertencem a terceiros: o "real" simulado usa o domínio
// da própria agência (cassiellos.com.br) e nenhum e-mail é enviado por estes testes.
const SIMULATED_REAL = 'lead.real.simulado@cassiellos.com.br'
const LISTED_TEST = 'equipe.teste@cassiellos.com.br'
const ALLOWLISTED = 'convite.teste@cassiellos.com.br'

describe('getCrmBookingMode', () => {
  it('padrão é test (ausente, vazio, erro de digitação)', () => {
    for (const raw of [undefined, '', ' ', 'test', 'TEST', 'production', 'liv', 'live-ish', 'true']) {
      assert.equal(getCrmBookingMode(raw), 'test', String(raw))
    }
  })
  it('somente "live" (sem diferenciar maiúsculas/espaços) ativa o modo real', () => {
    for (const raw of ['live', 'LIVE', ' Live ']) assert.equal(getCrmBookingMode(raw), 'live', raw)
  })
})

describe('parseTestEmails', () => {
  it('aceita vírgula, ponto e vírgula e espaços; normaliza; inclui a allowlist', () => {
    const set = parseTestEmails(` ${LISTED_TEST.toUpperCase()} ; outro.teste@cassiellos.com.br,  `, ALLOWLISTED)
    assert.deepEqual([...set].sort(), [ALLOWLISTED, LISTED_TEST, 'outro.teste@cassiellos.com.br'].sort())
  })
  it('ignora entradas sem @ e funciona sem variáveis definidas', () => {
    assert.deepEqual([...parseTestEmails('lixo, ;', '')], [])
    assert.deepEqual([...parseTestEmails(undefined, undefined)], [])
  })
})

describe('domínios e TLDs de teste', () => {
  it('domínios de exemplo (e subdomínios) são teste', () => {
    for (const email of ['a@example.com', 'a@example.net', 'a@example.org', 'a@exemplo.com',
      'a@exemplo.com.br', 'a@mail.example.com', 'A@EXEMPLO.COM']) {
      assert.equal(isTestEmailDomain(email), true, email)
    }
  })
  it('TLDs reservados (.test, .example, .invalid, .localhost) são teste', () => {
    for (const email of ['a@clinica.test', 'a@x.example', 'a@lead.invalid', 'a@host.localhost']) {
      assert.equal(isTestEmailDomain(email), true, email)
    }
  })
  it('não confunde domínios parecidos', () => {
    for (const email of [SIMULATED_REAL, 'a@notexample.com', 'a@example.com.br', 'a@exemplo.co']) {
      assert.equal(isTestEmailDomain(email), false, email)
    }
  })
})

describe('classifyNewLeadAsTest', () => {
  const testEmails = parseTestEmails(LISTED_TEST, ALLOWLISTED)

  it('modo test: TODO lead novo é teste, inclusive o real simulado', () => {
    for (const email of [SIMULATED_REAL, LISTED_TEST, ALLOWLISTED, 'a@exemplo.com', 'a@lead.invalid']) {
      assert.equal(classifyNewLeadAsTest({ email, mode: 'test', testEmails }), true, email)
    }
  })

  it('modo live: e-mail fora da lista e de domínio comum é REAL', () => {
    assert.equal(classifyNewLeadAsTest({ email: SIMULATED_REAL, mode: 'live', testEmails }), false)
    assert.equal(classifyNewLeadAsTest({ email: SIMULATED_REAL.toUpperCase(), mode: 'live', testEmails }), false)
  })

  it('modo live: e-mails listados e o da allowlist continuam teste', () => {
    assert.equal(classifyNewLeadAsTest({ email: LISTED_TEST, mode: 'live', testEmails }), true)
    assert.equal(classifyNewLeadAsTest({ email: ALLOWLISTED, mode: 'live', testEmails }), true)
    assert.equal(classifyNewLeadAsTest({ email: ' Convite.Teste@Cassiellos.com.br ', mode: 'live', testEmails }), true)
  })

  it('modo live: domínios de exemplo e TLDs reservados continuam teste (inclusive .invalid)', () => {
    for (const email of ['lead@example.com', 'lead@exemplo.com', 'lead@exemplo.com.br',
      'lead@clinica.invalid', 'lead@clinica.test']) {
      assert.equal(classifyNewLeadAsTest({ email, mode: 'live', testEmails }), true, email)
    }
  })

  it('e-mail malformado nunca é tratado como real', () => {
    assert.equal(isTestEmail('sem-arroba', testEmails), true)
    assert.equal(classifyNewLeadAsTest({ email: '', mode: 'live', testEmails }), true)
  })

  it('lê CRM_BOOKING_MODE/CRM_TEST_EMAILS/CRM_BOOKING_ALLOWED_EMAIL do ambiente quando não informados', () => {
    const saved = {
      mode: process.env.CRM_BOOKING_MODE,
      list: process.env.CRM_TEST_EMAILS,
      allowed: process.env.CRM_BOOKING_ALLOWED_EMAIL,
    }
    try {
      delete process.env.CRM_BOOKING_MODE
      assert.equal(classifyNewLeadAsTest({ email: SIMULATED_REAL }), true, 'sem variável = test')
      process.env.CRM_BOOKING_MODE = 'live'
      process.env.CRM_TEST_EMAILS = LISTED_TEST
      process.env.CRM_BOOKING_ALLOWED_EMAIL = ALLOWLISTED
      assert.equal(classifyNewLeadAsTest({ email: SIMULATED_REAL }), false)
      assert.equal(classifyNewLeadAsTest({ email: LISTED_TEST }), true)
      assert.equal(classifyNewLeadAsTest({ email: ALLOWLISTED }), true)
    } finally {
      for (const [key, value] of [['CRM_BOOKING_MODE', saved.mode], ['CRM_TEST_EMAILS', saved.list],
        ['CRM_BOOKING_ALLOWED_EMAIL', saved.allowed]] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe('isMetaDispatchAllowed', () => {
  it('só permite eventos com isTest === false explícito', () => {
    assert.equal(isMetaDispatchAllowed({ isTest: false, formSlug: 'odontologia' }), true)
    for (const metadata of [{ isTest: true }, {}, { isTest: 'false' }, { isTest: 0 }, null, undefined, 'x']) {
      assert.equal(isMetaDispatchAllowed(metadata), false, JSON.stringify(metadata))
    }
  })
})
