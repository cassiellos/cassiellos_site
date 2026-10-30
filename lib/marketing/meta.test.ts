import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONSENT_VERSION, hasMarketingConsent, parseConsent, serializeConsent } from '../privacy/consent'

const mk = (marketing: boolean, now?: Date) => serializeConsent({ analytics: null, marketing }, now)
import {
  META_EVENT_MAP, getMetaPixelConfig, isMetaTrackedPath, isValidFbc, isValidFbp,
  leadTrackingEventId, metaEventNameFor, resolveMarketingConsent, sanitizeMarketingConsent,
} from './meta'

describe('consentimento de marketing', () => {
  it('sem escolha = sem consentimento', () => {
    assert.equal(parseConsent(undefined), null)
    assert.equal(hasMarketingConsent(''), false)
    assert.equal(hasMarketingConsent('outro=1'), false)
  })
  it('aceite e recusa são lidos do cookie; formato inválido ou versão antiga é ignorado', () => {
    const now = new Date('2026-10-29T20:00:00Z')
    assert.equal(hasMarketingConsent('a=1; cassiellos_consent=' + mk(true, now)), true)
    assert.equal(hasMarketingConsent('cassiellos_consent=' + mk(false, now)), false)
    assert.equal(parseConsent('lixo'), null)
    assert.equal(parseConsent(encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION + 1, analytics: null, marketing: true, at: now.toISOString() }))), null)
    assert.deepEqual(parseConsent(mk(true, now)), { v: CONSENT_VERSION, analytics: null, marketing: true, at: now.toISOString() })
  })
  it('o cookie de consentimento não contém dados pessoais', () => {
    const raw = decodeURIComponent(mk(true))
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['analytics', 'at', 'marketing', 'v'])
  })
  it('escolha só de métricas (Etapa 3, v1) não autoriza marketing', () => {
    const v1 = encodeURIComponent(JSON.stringify({ v: 1, analytics: true, at: '2026-10-30T15:00:00Z' }))
    assert.equal(hasMarketingConsent('cassiellos_consent=' + v1), false)
    assert.equal(hasMarketingConsent('cassiellos_consent=' + serializeConsent({ analytics: true, marketing: null })), false)
    assert.equal(resolveMarketingConsent({ consent: true, decided: true }, 'cassiellos_consent=' + v1).consent, false)
  })
})

describe('Meta Pixel — configuração e rotas', () => {
  it('desligado por padrão; liga só com a chave E um ID numérico', () => {
    assert.deepEqual(getMetaPixelConfig({}), { enabled: false })
    assert.deepEqual(getMetaPixelConfig({ META_PIXEL_ID: '1234567890123456' }), { enabled: false })
    assert.deepEqual(getMetaPixelConfig({ META_PIXEL_ENABLED: 'true', META_PIXEL_ID: 'abc' }), { enabled: false })
    assert.deepEqual(getMetaPixelConfig({ META_PIXEL_ENABLED: 'yes', META_PIXEL_ID: '1234567890123456' }), { enabled: false })
    assert.deepEqual(getMetaPixelConfig({ META_PIXEL_ENABLED: 'true', META_PIXEL_ID: ' 1234567890123456 ' }),
      { enabled: true, pixelId: '1234567890123456' })
  })
  it('somente páginas públicas do funil; nunca CRM ou API', () => {
    assert.equal(isMetaTrackedPath('/agendar/odontologia'), true)
    assert.equal(isMetaTrackedPath('/agendar/outro-nicho'), true)
    for (const path of ['/crm', '/crm/login', '/api/booking/leads', '/', '/sobre', '/politica-de-privacidade', '/mini-crm', null]) {
      assert.equal(isMetaTrackedPath(path), false, String(path))
    }
  })
  it('mapeamento interno → Meta (mesmo nome no Pixel e na CAPI)', () => {
    assert.deepEqual({ ...META_EVENT_MAP }, { Lead: 'Lead', Chronos_Scheduled: 'Schedule' })
    assert.equal(metaEventNameFor('Chronos_Scheduled'), 'Schedule')
    assert.equal(metaEventNameFor('Purchase'), null)
    assert.equal(metaEventNameFor('toString'), null)
  })
  it('event_id do Lead é estável por lead (reenvios não geram nova conversão)', () => {
    const id = '3F2B1C4D-0000-4000-8000-00000000ABCD'
    assert.equal(leadTrackingEventId(id), 'lead_3f2b1c4d00004000800000000000abcd')
    assert.equal(leadTrackingEventId(id), leadTrackingEventId(id.toLowerCase()))
  })
})

describe('decisão C2 — o CRM recebe só sim/não; fbp/fbc nunca', () => {
  it('formatos de fbp/fbc (validação para a futura CAPI, sem gravação)', () => {
    assert.equal(isValidFbp('fb.1.1730000000000.1234567890'), true)
    assert.equal(isValidFbp('fb.1.abc.123'), false)
    assert.equal(isValidFbc('fb.1.1730000000000.IwAR0abcDEF_123-xyz'), true)
    assert.equal(isValidFbc('fb.1.1730000000000.<script>'), false)
  })
  it('sem escolha ou recusa: consent=false', () => {
    assert.deepEqual(sanitizeMarketingConsent(undefined), { consent: false, decided: false })
    assert.deepEqual(sanitizeMarketingConsent('true'), { consent: false, decided: false })
    assert.deepEqual(sanitizeMarketingConsent({ consent: false }), { consent: false, decided: false })
    assert.deepEqual(sanitizeMarketingConsent({ consent: false, decided: true }), { consent: false, decided: true })
  })
  it('com consentimento, fbp/fbc e qualquer outro campo são DESCARTADOS', () => {
    assert.deepEqual(sanitizeMarketingConsent({
      consent: true, fbp: 'fb.1.1730000000000.1234567890', fbc: 'fb.1.1730000000000.IwAR0abcDEF_123', email: 'x@y.com',
    }), { consent: true, decided: true })
    assert.deepEqual(sanitizeMarketingConsent({ consent: 'true', decided: 'yes' }), { consent: false, decided: false })
  })
})

describe('decisão G2 — consentimento validado no servidor ', () => {
  const accepted = 'outro=1; cassiellos_consent=' + mk(true, new Date('2026-10-29T12:00:00Z'))
  const refused = 'cassiellos_consent=' + mk(false, new Date('2026-10-29T12:00:00Z'))
  it('aceite só vale com o cookie da requisição confirmando', () => {
    assert.deepEqual(resolveMarketingConsent({ consent: true, decided: true }, accepted), { consent: true, decided: true })
    assert.deepEqual(resolveMarketingConsent({ consent: true, decided: true }, ''), { consent: false, decided: false })
    assert.deepEqual(resolveMarketingConsent({ consent: true, decided: true }, refused), { consent: false, decided: false })
    assert.deepEqual(resolveMarketingConsent({ consent: true }, 'cassiellos_consent=lixo'), { consent: false, decided: false })
    assert.deepEqual(resolveMarketingConsent(undefined, accepted), { consent: false, decided: false }, 'cookie sozinho não basta')
  })
  it('recusa explícita vale mesmo sem cookie', () => {
    assert.deepEqual(resolveMarketingConsent({ consent: false, decided: true }, null), { consent: false, decided: true })
  })
})
