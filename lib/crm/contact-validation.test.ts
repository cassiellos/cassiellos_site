import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMAIL_MESSAGE, PHONE_MESSAGES, formatPhoneInput, nationalPhoneDigits, nextPhoneInput,
  validateBrazilianPhone, validateEmailAddress,
} from './contact-validation'
import { validatedEmail, validatedPhone } from './booking-intake-request'

// Números e endereços fictícios (nenhum contato real).
describe('telefone brasileiro', () => {
  it('celular válido: com máscara, sem máscara, com +55 e colado com pontuação', () => {
    for (const raw of ['(31) 99876-5432', '31998765432', '+55 31 99876-5432', '+55 (31) 99876-5432', '55 31 99876.5432', ' 31 9 9876 5432 ']) {
      const r = validateBrazilianPhone(raw)
      assert.ok(r.ok, raw)
      assert.equal(r.ok && r.digits, '31998765432', raw)
    }
  })
  it('DDD 55 (RS) não é confundido com o código do país', () => {
    const r = validateBrazilianPhone('(55) 99876-5432')
    assert.equal(r.ok && r.digits, '55998765432')
  })
  it('fixo com DDD continua aceito (WhatsApp Business, regra da Etapa 5)', () => {
    const r = validateBrazilianPhone('(31) 3456-7890')
    assert.equal(r.ok && r.digits, '3134567890')
  })
  it('vazio ou incompleto: "Informe seu celular com DDD."', () => {
    for (const raw of ['', '   ', 'abc', '9876-5432', '(31) 9987', '319987654']) {
      const r = validateBrazilianPhone(raw)
      assert.equal(r.ok, false, raw)
      assert.equal(!r.ok && r.message, PHONE_MESSAGES.required, raw)
    }
  })
  it('DDD inexistente, celular sem 9, dígitos repetidos ou país estrangeiro: "Confira o número informado."', () => {
    for (const raw of ['(20) 99876-5432', '(01) 99876-5432', '(31) 89876-5432', '(31) 99999-9999', '(11) 90000-0000',
      '(31) 1234-5678', '(31) 3333-3333', '+1 415 555 0123', '+44 20 7946 0958', '319987654321']) {
      const r = validateBrazilianPhone(raw)
      assert.equal(r.ok, false, raw)
      assert.equal(!r.ok && r.message, PHONE_MESSAGES.invalid, raw)
    }
  })
  it('máscara progressiva sem ultrapassar 11 dígitos', () => {
    assert.equal(formatPhoneInput(''), '')
    assert.equal(formatPhoneInput('3'), '(3')
    assert.equal(formatPhoneInput('31'), '(31')
    assert.equal(formatPhoneInput('319'), '(31) 9')
    assert.equal(formatPhoneInput('319987'), '(31) 9987')
    assert.equal(formatPhoneInput('3199876'), '(31) 9987-6')
    assert.equal(formatPhoneInput('3134567890'), '(31) 3456-7890')
    assert.equal(formatPhoneInput('31998765432'), '(31) 99876-5432')
    assert.equal(formatPhoneInput('3199876543299'), '(31) 99876-5432')
    assert.equal(formatPhoneInput('+55 31 99876-5432'), '(31) 99876-5432')
  })
  it('colar e digitar: o campo recebe o valor já formatado', () => {
    assert.equal(nextPhoneInput('', '+55 (31) 99876-5432'), '(31) 99876-5432')
    assert.equal(nextPhoneInput('(31) 9987', '(31) 99876'), '(31) 9987-6')
    assert.equal(nextPhoneInput('', 'x3a1'), '(31')
  })
  it('apagar e reeditar: apagar um separador remove o dígito anterior (sem travar)', () => {
    assert.equal(nextPhoneInput('(31) 99876-5432', '(31) 99876-543'), '(31) 9987-6543')
    assert.equal(nextPhoneInput('(31) 9987-6', '(31) 9987-'), '(31) 9987')
    assert.equal(nextPhoneInput('(31) 9', '(31) '), '(31')
    assert.equal(nextPhoneInput('(31', '(3'), '(3')
    assert.equal(nextPhoneInput('(3', '('), '')
    assert.equal(nextPhoneInput('(31) 9987-6543', '(31) 9987-65437'), '(31) 99876-5437')
  })
  it('dígitos nacionais', () => {
    assert.equal(nationalPhoneDigits('+55 31 3456-7890'), '3134567890')
    assert.equal(nationalPhoneDigits(42), '')
  })
})

describe('e-mail (somente formato)', () => {
  it('válidos, inclusive subdomínio, "+" e provedores gratuitos ou pouco conhecidos', () => {
    for (const raw of ['maria@clinica-exemplo.com.br', 'ana.souza+agenda@mail.clinica.exemplo.com.br',
      'contato@exemplo.dental', 'joao_99@gmail.com', 'x@a.io', 'teste@xn--clnica-sta.com.br']) {
      assert.ok(validateEmailAddress(raw).ok, raw)
    }
  })
  it('espaços externos são removidos e o endereço vai em minúsculas', () => {
    assert.deepEqual(validateEmailAddress('  Maria.Souza@Clinica-Exemplo.COM.br  '), { ok: true, email: 'maria.souza@clinica-exemplo.com.br' })
  })
  it('inválidos: sem @, sem domínio, espaços internos, pontos ou hífens mal colocados, dois @, TLD numérico', () => {
    for (const raw of ['maria.clinica.com', 'maria@', 'maria@clinica', '@clinica.com.br', 'maria souza@clinica.com',
      'maria@clinica .com', 'maria..souza@clinica.com', '.maria@clinica.com', 'maria.@clinica.com', 'maria@-clinica.com',
      'maria@clinica-.com', 'maria@clinica..com', 'a@b@clinica.com', 'maria@clinica.c', 'maria@clinica.123', 'maria@[127.0.0.1]']) {
      const r = validateEmailAddress(raw)
      assert.equal(r.ok, false, raw)
      assert.equal(!r.ok && r.message, EMAIL_MESSAGE, raw)
    }
  })
  it('excessivamente longo: endereço > 180 caracteres ou parte local > 64', () => {
    assert.equal(validateEmailAddress('a'.repeat(65) + '@clinica.com').ok, false)
    assert.equal(validateEmailAddress('maria@' + 'sub.'.repeat(44) + 'com.br').ok, false)
    assert.equal(validateEmailAddress('a'.repeat(64) + '@clinica.com').ok, true)
  })
  it('vazio é obrigatório', () => {
    const r = validateEmailAddress('   ')
    assert.equal(!r.ok && r.code, 'EMAIL_REQUIRED')
  })
})

describe('mesmas regras no servidor (contrato de /api/booking/leads preservado)', () => {
  it('telefone válido é gravado como DDD + número em dígitos; inválido é recusado', () => {
    assert.equal(validatedPhone('+55 (31) 99876-5432'), '31998765432')
    assert.equal(validatedPhone('(31) 3456-7890'), '3134567890')
    for (const raw of ['(31) 99999-9999', '(20) 99876-5432', '9876-5432', '', null, 42]) assert.equal(validatedPhone(raw), null, String(raw))
  })
  it('e-mail válido é normalizado; inválido é recusado', () => {
    assert.equal(validatedEmail(' Maria@Clinica-Exemplo.com.br '), 'maria@clinica-exemplo.com.br')
    for (const raw of ['maria@clinica', 'maria souza@clinica.com', '', undefined]) assert.equal(validatedEmail(raw), null, String(raw))
  })
  it('navegador e servidor concordam em todos os casos', () => {
    for (const raw of ['(31) 99876-5432', '+55 31 99876-5432', '(31) 3456-7890', '(31) 99999-9999', '(20) 99876-5432', '319987']) {
      const browser = validateBrazilianPhone(raw)
      assert.equal(validatedPhone(raw), browser.ok ? browser.digits : null, raw)
    }
    for (const raw of ['maria@clinica-exemplo.com.br', 'maria@clinica', ' A@B.CO ']) {
      const browser = validateEmailAddress(raw)
      assert.equal(validatedEmail(raw), browser.ok ? browser.email : null, raw)
    }
  })
})
