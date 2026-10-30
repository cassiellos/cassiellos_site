import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { speedInsightsUrl, vercelAnalyticsUrl } from './analytics-policy'

describe('(a) Vercel Analytics e Speed Insights — escopo do CRM', () => {
  it('funil: sem gclid/fbclid/outros parâmetros; UTMs mantidos', () => {
    assert.equal(vercelAnalyticsUrl('https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&gclid=G1&fbclid=F1&x=1#a'),
      'https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta')
  })
  it('painel do CRM e Speed Insights: só origem + caminho', () => {
    assert.equal(vercelAnalyticsUrl('https://crm.cassiellos.com.br/crm?gclid=G1'), 'https://crm.cassiellos.com.br/crm')
    assert.equal(speedInsightsUrl('https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&gclid=G1'), 'https://crm.cassiellos.com.br/agendar/odontologia')
  })
})
