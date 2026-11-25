import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONSENT_MODE_DEFAULT, consentModeFrom, googleCookieNames } from './consent-mode'
import { ownsFunnelMetrics, isCrmScopePath } from './scope'

const denied = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }

describe('Consent Mode v2 a partir do consentimento do CRM', () => {
  it('padrão: os quatro sinais negados (e o objeto não pode ser alterado)', () => {
    assert.deepEqual({ ...CONSENT_MODE_DEFAULT }, denied)
    assert.throws(() => { (CONSENT_MODE_DEFAULT as { analytics_storage: string }).analytics_storage = 'granted' }, TypeError)
  })

  it('sem escolha (null) ou sem cookie: nada é concedido', () => {
    assert.deepEqual(consentModeFrom(null), denied)
    assert.deepEqual(consentModeFrom(undefined), denied)
    assert.deepEqual(consentModeFrom({ analytics: null, marketing: null }), denied)
  })

  it('métricas aceitas liberam só analytics_storage', () => {
    assert.deepEqual(consentModeFrom({ analytics: true, marketing: null }), { ...denied, analytics_storage: 'granted' })
    assert.deepEqual(consentModeFrom({ analytics: true, marketing: false }), { ...denied, analytics_storage: 'granted' })
  })

  it('o marketing atual (Meta) NÃO concede sinais do Google Ads enquanto o texto jurídico não os cobrir', () => {
    assert.deepEqual(consentModeFrom({ analytics: true, marketing: true }), { ...denied, analytics_storage: 'granted' })
    assert.deepEqual(consentModeFrom({ analytics: false, marketing: true }), denied)
  })

  it('com os sinais de anúncios autorizados no futuro, eles seguem só a escolha de marketing', () => {
    const on = { googleAdsSignals: true }
    assert.deepEqual(consentModeFrom({ analytics: false, marketing: true }, on), {
      analytics_storage: 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted',
    })
    assert.deepEqual(consentModeFrom({ analytics: true, marketing: false }, on), { ...denied, analytics_storage: 'granted' })
  })

  it('recusa e revogação voltam tudo para negado', () => {
    assert.deepEqual(consentModeFrom({ analytics: false, marketing: false }, { googleAdsSignals: true }), denied)
  })

  it('identifica só cookies do Google Analytics/Ads (nunca o cookie de consentimento nem outros)', () => {
    const header = '_ga=GA1.1.1; _ga_ABC123XYZ=GS2.1; _gid=1; _gat_gtag_G_1=1; _gcl_au=1.1; cassiellos_consent=x; _fbp=fb.1; sessao=1'
    assert.deepEqual(googleCookieNames(header), ['_ga', '_ga_ABC123XYZ', '_gid', '_gat_gtag_G_1', '_gcl_au'])
    assert.deepEqual(googleCookieNames(''), [])
  })
})

describe('jornadas com métricas próprias de funil', () => {
  it('/agendar e /formularios têm métricas próprias; o resto do site não', () => {
    for (const path of ['/agendar', '/agendar/odontologia', '/formularios/hamburguerias']) assert.equal(ownsFunnelMetrics(path), true, path)
    for (const path of ['/', '/contato', '/crm', '/agendarxyz', '/formulariosx']) assert.equal(ownsFunnelMetrics(path), false, path)
  })
  it('continua dentro do escopo do CRM para o consentimento', () => {
    for (const path of ['/agendar', '/formularios/hamburguerias']) assert.equal(isCrmScopePath(path), true)
  })
})
