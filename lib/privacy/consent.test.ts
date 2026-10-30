import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONSENT_COOKIE, consentCookieAttributes, hasAnalyticsConsent, parseConsent, readCookie, serializeConsent,
} from './consent'
import { analyticsPermitted, requiresAnalyticsConsent, speedInsightsEventUrl, vercelEventUrl } from './analytics-policy'

const at = new Date('2026-10-30T15:00:00Z')

describe('consentimento de métricas — cookie', () => {
  it('serializa e lê só a escolha (sem dado pessoal)', () => {
    const raw = serializeConsent(true, at)
    assert.deepEqual(parseConsent(raw), { v: 1, analytics: true, at: '2026-10-30T15:00:00.000Z' })
    assert.deepEqual(Object.keys(JSON.parse(decodeURIComponent(raw))).sort(), ['analytics', 'at', 'v'])
    assert.equal(parseConsent(serializeConsent(false, at))?.analytics, false)
  })
  it('valor ausente, corrompido, de outra versão ou não booleano = sem consentimento', () => {
    for (const raw of [null, '', 'x', '%7B', encodeURIComponent('{"v":2,"analytics":true,"at":"2026-10-30T00:00:00Z"}'),
      encodeURIComponent('{"v":1,"analytics":"yes","at":"2026-10-30T00:00:00Z"}'),
      encodeURIComponent('{"v":1,"analytics":true,"at":"nunca"}')]) {
      assert.equal(parseConsent(raw), null)
    }
    assert.equal(hasAnalyticsConsent(''), false)
    assert.equal(hasAnalyticsConsent('outro=1'), false)
  })
  it('lê o cookie certo no cabeçalho (com outros cookies e atributos)', () => {
    const header = 'a=1; ' + CONSENT_COOKIE + '=' + serializeConsent(true, at) + '; b=2'
    assert.equal(hasAnalyticsConsent(header), true)
    assert.equal(hasAnalyticsConsent(CONSENT_COOKIE + '=' + serializeConsent(false, at)), false)
    assert.equal(readCookie('x_cassiellos_consent=1', CONSENT_COOKIE), null)
  })
  it('atributos: primário, 180 dias, Lax; Secure só em HTTPS', () => {
    assert.equal(consentCookieAttributes(true), 'Path=/; Max-Age=15552000; SameSite=Lax; Secure')
    assert.equal(consentCookieAttributes(false), 'Path=/; Max-Age=15552000; SameSite=Lax')
  })
})

describe('consentimento de métricas — Vercel Analytics e Speed Insights', () => {
  const funnel = 'https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&utm_medium=paid_social&gclid=G1&fbclid=F1'
  it('escopo do CRM exige consentimento; site institucional não muda', () => {
    for (const path of ['/agendar/odontologia', '/agendar', '/crm', '/crm/leads', '/mini-crm']) assert.equal(requiresAnalyticsConsent(path), true)
    for (const path of ['/', '/en', '/politica-de-cookies', '/agendarx', '/contato']) assert.equal(requiresAnalyticsConsent(path), false)
    assert.equal(analyticsPermitted('/agendar/x', false), false)
    assert.equal(analyticsPermitted('/', false), true)
  })
  it('sem consentimento (ou após revogação) o beforeSend descarta o evento do CRM', () => {
    assert.equal(vercelEventUrl(funnel, false), null)
    assert.equal(speedInsightsEventUrl(funnel, false), null)
    assert.equal(vercelEventUrl('https://crm.cassiellos.com.br/crm', false), null)
  })
  it('com consentimento: URL minimizada (sem gclid/fbclid), UTMs mantidos', () => {
    assert.equal(vercelEventUrl(funnel, true), 'https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&utm_medium=paid_social')
    assert.equal(speedInsightsEventUrl(funnel, true), 'https://crm.cassiellos.com.br/agendar/odontologia')
  })
  it('site institucional: URL exatamente como antes, com ou sem escolha', () => {
    const site = 'https://cassiellos.com.br/?utm_source=google&gclid=G1'
    assert.equal(vercelEventUrl(site, false), site)
    assert.equal(speedInsightsEventUrl(site, false), site)
  })
})
