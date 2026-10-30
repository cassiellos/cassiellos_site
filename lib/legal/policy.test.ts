import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEAD_POLICY_VERSION, MARKETING_POLICY_VERSION } from '../crm/lead-intake'
import {
  LEGAL_CONTROLLER, LEGAL_POLICY_VERSION, controllerIdentification, formatPolicyDate, legalPublicationBlockers,
} from './policy'

describe('textos jurídicos — versão única e controlador', () => {
  it('Privacidade, Cookies e consentimentos usam a MESMA versão', () => {
    assert.equal(MARKETING_POLICY_VERSION, LEGAL_POLICY_VERSION)
    assert.equal(LEAD_POLICY_VERSION, LEGAL_POLICY_VERSION)
    assert.match(LEGAL_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}(\.\d+)?$/)
  })
  it('a versão nunca é uma data futura', () => {
    const today = new Date().toISOString().slice(0, 10)
    assert.ok(LEGAL_POLICY_VERSION.slice(0, 10) <= today, LEGAL_POLICY_VERSION + ' está no futuro')
  })
  it('data exibida por extenso', () => {
    assert.equal(formatPolicyDate('2026-10-30'), '30 de outubro de 2026')
    assert.equal(formatPolicyDate('2026-11-04.2'), '4 de novembro de 2026')
    assert.throws(() => formatPolicyDate('30/10/2026'))
    assert.throws(() => formatPolicyDate('2026-13-01'))
  })
  it('nada é presumido: sem aprovação, a identificação não aparece e a publicação fica bloqueada', () => {
    assert.equal(LEGAL_CONTROLLER.dataProtectionOfficer, null)
    if (!LEGAL_CONTROLLER.identificationConfirmed) assert.equal(controllerIdentification(), null)
    assert.equal(controllerIdentification({ ...LEGAL_CONTROLLER, identificationConfirmed: false }), null)
    assert.equal(controllerIdentification({ ...LEGAL_CONTROLLER, identificationConfirmed: true }),
      'CASSIELLOS COMUNICAÇÃO E SERVIÇOS DIGITAIS LTDA (CNPJ 67.311.701/0001-12)')
  })
  it('CNPJ cadastrado com dígitos verificadores válidos', () => {
    const digits = (LEGAL_CONTROLLER.cnpj ?? '').replace(/\D/g, '').split('').map(Number)
    const dv = (nums: number[], weights: number[]) => {
      const rest = nums.reduce((sum, n, i) => sum + n * weights[i], 0) % 11
      return rest < 2 ? 0 : 11 - rest
    }
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    assert.equal(digits.length, 14)
    assert.equal(dv(digits.slice(0, 12), w1), digits[12])
    assert.equal(dv(digits.slice(0, 13), [6, ...w1]), digits[13])
  })
  it('bloqueios somem só quando tudo for aprovado', () => {
    const ready = {
      ...LEGAL_CONTROLLER, identificationConfirmed: true, privacyChannelConfirmed: true,
      smallAgentStatusConfirmed: true, consentRetentionDefined: true,
    }
    assert.deepEqual(legalPublicationBlockers(ready), [])
    assert.deepEqual(legalPublicationBlockers({ ...ready, smallAgentStatusConfirmed: false }),
      ['Encarregado não indicado e enquadramento como agente de pequeno porte não confirmado'])
    assert.deepEqual(legalPublicationBlockers({
      ...ready, smallAgentStatusConfirmed: false, dataProtectionOfficer: { name: 'Pessoa', email: 'dpo@exemplo.com' },
    }), [])
    assert.equal(legalPublicationBlockers({ ...ready, consentRetentionDefined: false }).length, 1)
  })
})
