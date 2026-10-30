import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flowAttribution } from './analytics-policy'

describe('(b) AnalyticsFlow — funil de agendamento e painel do CRM', () => {
  it('funil: gclid e fbclid = null (formato mantido); UTMs higienizados', () => {
    assert.deepEqual(flowAttribution('/agendar/odontologia', '?utm_source=meta&utm_medium=paid&utm_campaign=120200000000000&utm_content=ana@ex.com&gclid=G1&fbclid=F1'),
      { utm_source: 'meta', utm_medium: 'paid', utm_campaign: '120200000000000', utm_content: null, gclid: null, fbclid: null })
  })
  it('sem parâmetros: tudo null', () => {
    assert.deepEqual(flowAttribution('/agendar/odontologia', ''),
      { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, gclid: null, fbclid: null })
  })
})
