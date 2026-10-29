import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEAD_POLICY_VERSION, MARKETING_POLICY_VERSION } from '../crm/lead-intake'
import { LEGAL_CONTROLLER, LEGAL_POLICY_VERSION, formatPolicyDate, legalPublicationBlockers } from './policy'

describe('textos jurídicos — versão única e controlador', () => {
  it('decisão E: Privacidade, Cookies e consentimentos usam a MESMA versão', () => {
    assert.equal(MARKETING_POLICY_VERSION, LEGAL_POLICY_VERSION)
    assert.equal(LEAD_POLICY_VERSION, LEGAL_POLICY_VERSION)
    assert.match(LEGAL_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}(\.\d+)?$/)
  })
  it('a versão nunca é uma data futura', () => {
    const today = new Date().toISOString().slice(0, 10)
    assert.ok(LEGAL_POLICY_VERSION.slice(0, 10) <= today, LEGAL_POLICY_VERSION + ' está no futuro')
  })
  it('data exibida por extenso', () => {
    assert.equal(formatPolicyDate('2026-10-29'), '29 de outubro de 2026')
    assert.equal(formatPolicyDate('2026-11-04.2'), '4 de novembro de 2026')
    assert.throws(() => formatPolicyDate('29/10/2026'))
    assert.throws(() => formatPolicyDate('2026-13-01'))
  })
  it('decisão D: nada é inventado — campos empresariais pendentes ficam vazios e bloqueiam a publicação', () => {
    assert.equal(LEGAL_CONTROLLER.legalName, null)
    assert.equal(LEGAL_CONTROLLER.cnpj, null)
    assert.equal(LEGAL_CONTROLLER.dataProtectionOfficer, null)
    assert.equal(LEGAL_CONTROLLER.privacyChannel, 'cassiellosagencia@gmail.com')
    assert.ok(legalPublicationBlockers().length >= 4)
  })
  it('bloqueios somem quando os dados forem confirmados', () => {
    const ready = {
      ...LEGAL_CONTROLLER, legalName: 'Exemplo Ltda', cnpj: '00.000.000/0001-00', privacyChannelConfirmed: true,
      smallAgentStatusConfirmed: true, consentRetentionDefined: true,
    }
    assert.deepEqual(legalPublicationBlockers(ready), [])
    assert.deepEqual(legalPublicationBlockers({ ...ready, smallAgentStatusConfirmed: false }),
      ['Encarregado não indicado e enquadramento como agente de pequeno porte não confirmado'])
    assert.deepEqual(legalPublicationBlockers({
      ...ready, smallAgentStatusConfirmed: false, dataProtectionOfficer: { name: 'Pessoa', email: 'dpo@exemplo.com' },
    }), [])
  })
})
