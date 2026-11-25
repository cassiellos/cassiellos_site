import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { pushTrackingEvent } from './datalayer-client'
import { toDataLayerEvent } from './funnel-contract'
import { setAnalyticsConsent } from '../privacy/consent-client'

/*
 * Emissor do dataLayer no "navegador" simulado: window/document/sessionStorage/fetch.
 * Confere consentimento, recusa, revogação, prévia, deduplicação, ausência de dados pessoais, separação teste × real
 * e que o AnalyticsFlow recebe UM form_submit por lead real (e nunca por pergunta).
 */
type Call = { kind: string; body: unknown }
const calls: Call[] = []
const store = new Map<string, string>()
const win = new EventTarget() as EventTarget & Record<string, unknown>
Object.assign(win, {
  location: new URL('https://crm.cassiellos.com.br/formularios/hamburguerias?utm_source=meta&utm_medium=paid_social&fbclid=F1&gclid=G1'),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
})
win.addEventListener('cassiellos:track', event => calls.push({ kind: 'local', body: (event as CustomEvent).detail }))
const doc = { cookie: '', referrer: 'https://l.instagram.com/?u=https%3A%2F%2Fexemplo.com%2F%3Femail%3Dmaria%40x.com' }
Object.assign(globalThis, { window: win, document: doc })
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ kind: 'flow:' + url, body: JSON.parse(String(init.body)) })
  return new Response('{}')
}) as typeof fetch

const base = { form_id: 'hamburguerias', environment_mode: 'live', form_version: 'v2', flow_variant: 'cover' }
const layer = () => (win.dataLayer as unknown[] | undefined) ?? []
const flow = () => calls.filter(call => call.kind.startsWith('flow:'))

describe('dataLayer do funil no navegador', () => {
  beforeEach(() => { calls.length = 0; delete win.dataLayer })

  it('sem escolha: nada é enviado, nada é guardado e o dataLayer nem é criado', () => {
    store.clear()
    assert.equal(pushTrackingEvent('form_view', base), false)
    assert.equal(pushTrackingEvent('generate_lead', base, 'lead-1'), false)
    assert.equal(layer().length, 0)
    assert.equal(win.dataLayer, undefined)
    assert.equal(calls.length, 0)
    assert.equal(store.size, 0)
  })

  it('recusa de métricas: nada é enviado', () => {
    setAnalyticsConsent(false)
    assert.equal(pushTrackingEvent('form_view', base), false)
    assert.equal(layer().length, 0)
  })

  it('marketing aceito sem métricas também não libera o funil', () => {
    doc.cookie = ''
    setAnalyticsConsent(false)
    assert.equal(pushTrackingEvent('form_step_view', { ...base, step_id: 'q1' }), false)
    assert.equal(layer().length, 0)
  })

  it('aceite: um objeto no dataLayer, só com parâmetros permitidos, sem dado pessoal, uma vez só', () => {
    setAnalyticsConsent(true)
    const input = {
      ...base, step_id: 'q_whats', step_index: 3, step_type: 'question',
      email: 'maria@clinica.com.br', whatsapp: '(31) 99876-5432', answer: 'Minha resposta', name: 'Maria',
    }
    assert.equal(pushTrackingEvent('form_step_complete', input), true)
    assert.equal(pushTrackingEvent('form_step_complete', input), false)
    assert.deepEqual(layer(), [toDataLayerEvent('form_step_complete', {
      form_id: 'hamburguerias', environment_mode: 'live', form_version: 'v2',
      flow_variant: 'cover', step_id: 'q_whats', step_index: 3, step_type: 'question',
    })])
    const everything = JSON.stringify([layer(), calls, [...store.values()]])
    for (const leak of ['maria', '99876', 'Minha resposta']) assert.equal(everything.includes(leak), false, leak)
    assert.equal(calls.filter(c => c.kind === 'local').length, 1)
  })

  it('prévia do painel nunca emite, nem com consentimento', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('form_view', { ...base, environment_mode: 'preview' }), false)
    assert.equal(layer().length, 0)
  })

  it('deduplicação sobrevive à atualização da página (sessionStorage) e não guarda a referência', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('booking_meeting_confirmed', base, 'booking-1'), true)
    delete require.cache[require.resolve('./datalayer-client')]
    const fresh = require('./datalayer-client') as typeof import('./datalayer-client')
    assert.equal(fresh.pushTrackingEvent('booking_meeting_confirmed', base, 'booking-1'), false)
    assert.equal(fresh.pushTrackingEvent('booking_meeting_confirmed', base, 'booking-2'), true)
    assert.equal(JSON.stringify([...store.values()]).includes('booking-1'), false)
    assert.equal(layer().filter(item => (item as { event: string }).event === 'booking_meeting_confirmed').length, 2)
  })

  it('evento que exige referência e não a recebeu é descartado (não há como evitar duplicidade)', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('generate_lead', base), false)
    assert.equal(pushTrackingEvent('booking_meeting_confirmed', base, null), false)
    assert.equal(layer().length, 0)
  })

  it('lead de teste não chega ao AnalyticsFlow; lead real chega UMA vez como form_submit (sem gclid/fbclid)', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('generate_lead', { ...base, environment_mode: 'test' }, 'lead-teste'), true)
    assert.equal(flow().length, 0)
    assert.equal(pushTrackingEvent('generate_lead', base, 'lead-real'), true)
    assert.equal(pushTrackingEvent('generate_lead', base, 'lead-real'), false)
    assert.equal(flow().length, 1)
    const payload = flow()[0].body as Record<string, unknown>
    assert.equal(flow()[0].kind, 'flow:/api/analyticsflow/events')
    assert.equal(payload.event_type, 'form_submit')
    assert.equal(payload.content_id, 'form:hamburguerias')
    assert.equal(payload.url, 'https://crm.cassiellos.com.br/formularios/hamburguerias')
    assert.equal(payload.referrer, 'https://l.instagram.com/')
    assert.equal(payload.gclid, null)
    assert.equal(payload.fbclid, null)
  })

  it('perguntas respondidas e cliques NUNCA viram form_submit no AnalyticsFlow', () => {
    setAnalyticsConsent(true)
    for (const [index, id] of ['q1', 'q2', 'q3', 'q_nome', 'q_whats'].entries()) {
      pushTrackingEvent('form_step_view', { ...base, step_id: id, step_index: index })
      pushTrackingEvent('form_step_complete', { ...base, step_id: id, step_index: index })
    }
    pushTrackingEvent('lead_submit_attempt', base, 'envio-1')
    pushTrackingEvent('booking_slot_selected', base, '2026-11-25T13:00:00Z')
    assert.equal(flow().length, 0)
  })

  it('revogação interrompe novas coletas imediatamente', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('form_view', base), true)
    setAnalyticsConsent(false)
    assert.equal(pushTrackingEvent('form_start', base), false)
    assert.equal(pushTrackingEvent('generate_lead', base, 'lead-9'), false)
    assert.equal(layer().length, 1)
    assert.equal(flow().length, 0)
  })

  it('a ponte dos eventos antigos não deduplica de novo (o emissor antigo já deduplicou)', () => {
    setAnalyticsConsent(true)
    assert.equal(pushTrackingEvent('form_view', base, null, { dedupe: false }), true)
    assert.equal(pushTrackingEvent('form_view', base, null, { dedupe: false }), true)
    assert.equal(layer().length, 2)
  })
})
