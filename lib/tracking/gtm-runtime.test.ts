import assert from 'node:assert/strict'
import { toDataLayerEvent } from './funnel-contract'
import { beforeEach, describe, it } from 'node:test'
import { GTM_SCRIPT_ID, resetGoogleTagManagerForTests, startGoogleTagManager } from './gtm-runtime'
import { setAnalyticsConsent, setMarketingConsent } from '../privacy/consent-client'

/*
 * GTM no "navegador" simulado: consent default ANTES de qualquer script, carregamento só após o aceite de métricas,
 * recusa/revogação voltam para "denied", cookies do Google removidos, ponte dos eventos antigos sem duplicar.
 */
const win = new EventTarget() as EventTarget & Record<string, unknown>
const scripts: Array<{ id: string; src: string; async: boolean }> = []
const cookies = new Map<string, string>()
const store = new Map<string, string>()
const doc = {
  head: { appendChild: (node: { id: string; src: string; async: boolean }) => void scripts.push(node) },
  createElement: () => ({ id: '', src: '', async: false }),
  getElementById: (id: string) => scripts.find(script => script.id === id) ?? null,
  referrer: '',
  get cookie() { return [...cookies].map(([k, v]) => k + '=' + v).join('; ') },
  set cookie(value: string) {
    const [pair, ...attrs] = value.split(';').map(part => part.trim())
    const [name, ...rest] = pair.split('=')
    if (attrs.some(attr => /^Max-Age=0$/i.test(attr))) cookies.delete(name)
    else cookies.set(name, rest.join('='))
  },
}
Object.assign(win, {
  location: Object.assign(new URL('https://crm.cassiellos.com.br/formularios/hamburguerias'), { protocol: 'https:' }),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
})
Object.assign(globalThis, { window: win, document: doc, location: (win as unknown as { location: Location }).location })
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const layer = () => (win.dataLayer as unknown[]) ?? []
const command = (entry: unknown) => Array.from(entry as ArrayLike<unknown>)
const consents = () => layer().filter(entry => !Array.isArray(entry) && typeof entry === 'object' && (entry as { length?: number }).length === 3)
  .map(command)

describe('Google Tag Manager do formulário com Consent Mode v2', () => {
  let stop: () => void = () => undefined
  beforeEach(() => {
    stop()
    delete win.dataLayer
    scripts.length = 0
    cookies.clear()
    store.clear()
    resetGoogleTagManagerForTests()
  })

  it('sem container configurado: nada é criado, empurrado ou carregado', () => {
    stop = startGoogleTagManager(null)
    stop = startGoogleTagManager('<script>')
    assert.equal(win.dataLayer, undefined)
    assert.equal(scripts.length, 0)
  })

  it('sem escolha do visitante: consent default negado, nenhum script do Google e nenhum evento', () => {
    cookies.clear()
    stop = startGoogleTagManager('GTM-ABC1234')
    const [first] = consents()
    assert.deepEqual(first.slice(0, 2), ['consent', 'default'])
    assert.deepEqual(first[2], {
      analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    })
    assert.equal(scripts.length, 0)
    assert.equal(layer().some(entry => (entry as { event?: string }).event === 'gtm.js'), false)
  })

  it('aceite de métricas: update granted só em analytics_storage, depois o script (default sempre primeiro)', () => {
    stop = startGoogleTagManager('GTM-ABC1234')
    setAnalyticsConsent(true)
    const steps = consents().map(entry => entry[1])
    assert.deepEqual(steps, ['default', 'update'])
    assert.deepEqual(consents()[1][2], {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    })
    assert.equal(scripts.length, 1)
    assert.equal(scripts[0].id, GTM_SCRIPT_ID)
    assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234')
    // O consentimento precede o gtm.js no dataLayer.
    const order = layer().map(entry => (entry as { event?: string }).event === 'gtm.js' ? 'gtm.js' : command(entry)[1])
    assert.ok(order.indexOf('default') < order.indexOf('update') && order.indexOf('update') < order.indexOf('gtm.js'))
  })

  it('marketing aceito (Meta) não concede nenhum sinal de anúncios do Google', () => {
    stop = startGoogleTagManager('GTM-ABC1234')
    setMarketingConsent(true)
    for (const entry of consents()) {
      const state = entry[2] as Record<string, string>
      assert.equal(state.ad_storage, 'denied')
      assert.equal(state.ad_user_data, 'denied')
      assert.equal(state.ad_personalization, 'denied')
    }
    assert.equal(scripts.length, 0, 'sem métricas autorizadas o GTM não carrega')
  })

  it('revogação: update de volta para negado, cookies do Google removidos e eventos do funil param', () => {
    stop = startGoogleTagManager('GTM-ABC1234')
    setAnalyticsConsent(true)
    cookies.set('_ga', 'GA1.1.1')
    cookies.set('_ga_XYZ123', 'GS2.1')
    cookies.set('_fbp', 'fb.1')
    setAnalyticsConsent(false)
    const updates = consents().filter(entry => entry[1] === 'update')
    assert.equal((updates.at(-1)![2] as Record<string, string>).analytics_storage, 'denied')
    assert.equal(cookies.has('_ga'), false)
    assert.equal(cookies.has('_ga_XYZ123'), false)
    assert.equal(cookies.has('_fbp'), true, 'só os cookies do Google são removidos aqui')
    assert.ok(cookies.has('cassiellos_consent'))
    const before = layer().length
    win.dispatchEvent(new CustomEvent('cassiellos:funnel', { detail: { name: 'booking_form_view', form: 'hamburguerias', mode: 'live' } }))
    assert.equal(layer().length, before)
  })

  it('ponte: evento antigo do /agendar vira evento do contrato, uma vez, sem dado extra', () => {
    stop = startGoogleTagManager('GTM-ABC1234')
    setAnalyticsConsent(true)
    win.dispatchEvent(new CustomEvent('cassiellos:funnel', {
      detail: { name: 'booking_lead_registered', form: 'hamburguerias', mode: 'test', state: 'confirmed', email: 'a@b.com' },
    }))
    const events = layer().filter(entry => (entry as { event?: string }).event === 'generate_lead')
    assert.deepEqual(events, [toDataLayerEvent('generate_lead', { form_id: 'hamburguerias', environment_mode: 'test', funnel_stage: 'capture' })])
    assert.equal(JSON.stringify(layer()).includes('a@b.com'), false)
  })

  it('montar duas vezes (navegação) não repete o consent default nem o script', () => {
    stop = startGoogleTagManager('GTM-ABC1234')
    setAnalyticsConsent(true)
    stop()
    stop = startGoogleTagManager('GTM-ABC1234')
    assert.equal(consents().filter(entry => entry[1] === 'default').length, 1)
    assert.equal(scripts.length, 1)
  })
})
