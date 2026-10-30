import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { readMarketingConsent, trackMetaConversion } from './meta-client'
import { setAnalyticsConsent, setMarketingConsent } from '../privacy/consent-client'

/*
 * Conversões do Meta Pixel no "navegador" simulado (window/document/sessionStorage e window.fbq).
 * Confere consentimento de marketing, revogação, deduplicação e ausência de dados pessoais.
 */
const fbqCalls: unknown[][] = []
const store = new Map<string, string>()
const win = new EventTarget() as EventTarget & Record<string, unknown>
Object.assign(win, {
  location: new URL('https://crm.cassiellos.com.br/agendar/odontologia?fbclid=F1&utm_source=meta'),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  fbq: (...args: unknown[]) => void fbqCalls.push(args),
})
const doc = { cookie: '' }
Object.assign(globalThis, { window: win, document: doc, sessionStorage: win.sessionStorage, location: win.location })

const LEAD = 'lead_' + '0123456789abcdef0123456789abcdef'
const SCHEDULE = 'chronos_scheduled_' + 'fedcba9876543210fedcba9876543210'

describe('Meta Pixel — conversões no navegador', () => {
  beforeEach(() => { fbqCalls.length = 0 })

  it('sem escolha ou só com métricas aceitas: nenhuma conversão', () => {
    assert.deepEqual(readMarketingConsent(), { consent: false, decided: false })
    assert.equal(trackMetaConversion('Lead', LEAD), false)
    setAnalyticsConsent(true)
    assert.deepEqual(readMarketingConsent(), { consent: false, decided: false }, 'métricas não autorizam marketing')
    assert.equal(trackMetaConversion('Lead', LEAD), false)
    assert.equal(fbqCalls.length, 0)
  })

  it('marketing recusado: nenhuma conversão', () => {
    setMarketingConsent(false)
    assert.deepEqual(readMarketingConsent(), { consent: false, decided: true })
    assert.equal(trackMetaConversion('Schedule', SCHEDULE), false)
    assert.equal(fbqCalls.length, 0)
  })

  it('marketing aceito: envia com o event_id do CRM e só o slug do formulário', () => {
    setMarketingConsent(true)
    assert.equal(trackMetaConversion('Lead', LEAD, { content_name: 'odontologia' }), true)
    assert.deepEqual(fbqCalls, [['track', 'Lead', { content_name: 'odontologia' }, { eventID: LEAD }]])
  })

  it('mesmo event_id (recarga, retry, clique repetido) não é enviado de novo', () => {
    assert.equal(trackMetaConversion('Lead', LEAD, { content_name: 'odontologia' }), false)
    assert.equal(fbqCalls.length, 0)
  })

  it('event_id ausente/inválido ou parâmetro com dado pessoal: descartado', () => {
    for (const id of [undefined, null, 42, '', 'a b', 'maria@clinica.com', 'x'.repeat(200)]) {
      assert.equal(trackMetaConversion('Schedule', id), false)
    }
    assert.equal(trackMetaConversion('Schedule', SCHEDULE, { content_name: 'maria@clinica.com' }), true)
    assert.deepEqual(fbqCalls, [['track', 'Schedule', {}, { eventID: SCHEDULE }]])
    const sent = JSON.stringify(fbqCalls)
    for (const pii of ['@', 'fbclid', 'F1', 'utm_']) assert.equal(sent.includes(pii), false, pii)
  })

  it('revogação vale na hora; preferência de métricas é preservada', () => {
    setAnalyticsConsent(true)
    setMarketingConsent(false)
    assert.equal(trackMetaConversion('Lead', 'lead_' + 'a'.repeat(32)), false)
    assert.equal(fbqCalls.length, 0)
    assert.match(decodeURIComponent(doc.cookie), /"analytics":true,"marketing":false/)
  })

  it('sem Pixel carregado (chave desligada): nada acontece', () => {
    setMarketingConsent(true)
    const fbq = win.fbq
    delete win.fbq
    assert.equal(trackMetaConversion('Lead', 'lead_' + 'b'.repeat(32)), false)
    win.fbq = fbq
  })
})
