import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { emitFunnel } from './funnel-client'
import { setAnalyticsConsent } from '../privacy/consent-client'

/*
 * Emissor do funil no "navegador" simulado: window/document/sessionStorage/fetch e a fila da Vercel (window.va).
 * Confere consentimento, revogação, deduplicação, ausência de dados pessoais e separação teste × real.
 */
type Call = { kind: string; body: unknown }
const calls: Call[] = []
const store = new Map<string, string>()
const win = new EventTarget() as EventTarget & Record<string, unknown>
Object.assign(win, {
  location: new URL('https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&utm_medium=paid_social&gclid=G1&fbclid=F1'),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  va: (...args: unknown[]) => void calls.push({ kind: 'vercel', body: args }),
})
win.addEventListener('cassiellos:funnel', event => calls.push({ kind: 'local', body: (event as CustomEvent).detail }))
const doc = { cookie: '', referrer: 'https://www.google.com/search?q=maria%40x.com' }
Object.assign(globalThis, { window: win, document: doc })
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ kind: 'flow:' + url, body: JSON.parse(String(init.body)) })
  return new Response('{}')
}) as typeof fetch

// Os módulos só leem window/document no momento da chamada: os globais simulados valem para eles.

const base = { form: 'odontologia', mode: 'test' }
const ofKind = (kind: string) => calls.filter(call => call.kind === kind)

describe('funil no navegador', () => {
  beforeEach(() => { calls.length = 0 })

  it('sem escolha: nada é enviado nem guardado', () => {
    assert.equal(emitFunnel('booking_form_view', base), false)
    assert.equal(emitFunnel('booking_lead_registered', { ...base, mode: 'live' }, 'lead-1'), false)
    assert.equal(calls.length, 0)
    assert.equal(store.size, 0)
  })

  it('recusa: nada é enviado', () => {
    setAnalyticsConsent(false)
    assert.equal(emitFunnel('booking_form_view', base), false)
    assert.equal(calls.length, 0)
  })

  it('aceite: Vercel + evento local, uma vez só (sem dados pessoais)', () => {
    setAnalyticsConsent(true)
    assert.equal(emitFunnel('booking_form_view', { ...base, email: 'maria@clinica.com.br' }), true)
    assert.equal(emitFunnel('booking_form_view', base), false)
    assert.equal(ofKind('vercel').length, 1)
    assert.deepEqual(ofKind('vercel')[0].body, ['event', { name: 'booking_form_view', data: base, options: undefined }])
    assert.deepEqual(ofKind('local')[0].body, { name: 'booking_form_view', ...base })
    assert.equal(JSON.stringify(calls).includes('maria'), false)
  })

  it('deduplicação sobrevive à atualização da página (sessionStorage)', () => {
    assert.equal(emitFunnel('booking_meeting_confirmed', { ...base, state: 'confirmed' }, 'booking-1'), true)
    // Recarrega o módulo (memória zerada), como numa atualização da página na mesma aba.
    delete require.cache[require.resolve('./funnel-client')]
    const fresh = require('./funnel-client') as typeof import('./funnel-client')
    assert.equal(fresh.emitFunnel('booking_meeting_confirmed', { ...base, state: 'confirmed' }, 'booking-1'), false)
    assert.equal(fresh.emitFunnel('booking_meeting_confirmed', { ...base, state: 'confirmed' }, 'booking-2'), true)
    assert.equal(JSON.stringify([...store.values()]).includes('booking-1'), false)
  })

  it('teste não chega ao AnalyticsFlow; lead real chega uma vez como form_submit', () => {
    assert.equal(emitFunnel('booking_lead_registered', base, 'lead-test'), true)
    assert.equal(calls.filter(call => call.kind.startsWith('flow:')).length, 0)
    assert.equal(emitFunnel('booking_lead_registered', { ...base, mode: 'live' }, 'lead-real'), true)
    assert.equal(emitFunnel('booking_lead_registered', { ...base, mode: 'live' }, 'lead-real'), false)
    const flow = calls.filter(call => call.kind.startsWith('flow:'))
    assert.equal(flow.length, 1)
    assert.equal(flow[0].kind, 'flow:/api/analyticsflow/events')
    const payload = flow[0].body as Record<string, unknown>
    assert.equal(payload.event_type, 'form_submit')
    assert.equal(payload.content_id, 'booking:odontologia')
    assert.equal(payload.url, 'https://crm.cassiellos.com.br/agendar/odontologia')
    assert.equal(payload.referrer, 'https://www.google.com/search')
    assert.equal(payload.gclid, null)
    assert.equal(payload.fbclid, null)
    assert.equal(payload.utm_source, 'meta')
  })

  it('revogação interrompe novas coletas imediatamente', () => {
    setAnalyticsConsent(false)
    assert.equal(emitFunnel('booking_slot_selected', { ...base, days_ahead: 1 }, 'slot-1'), false)
    assert.equal(emitFunnel('booking_lead_registered', { ...base, mode: 'live' }, 'lead-3'), false)
    assert.equal(calls.length, 0)
  })

  it('aceite antes de o script montar: fila criada com o beforeSend na frente (nada se perde nem sai sem minimizar)', () => {
    setAnalyticsConsent(true)
    delete win.va
    assert.equal(emitFunnel('booking_form_start', base), true)
    const queue = win.vaq as unknown[][]
    assert.equal(queue[0][0], 'beforeSend')
    assert.deepEqual(queue[1], ['event', { name: 'booking_form_start', data: base, options: undefined }])
    const beforeSend = queue[0][1] as (event: { url: string }) => { url: string } | null
    const url = 'https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&gclid=G1&fbclid=F1'
    assert.deepEqual(beforeSend({ url }), { url: 'https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta' })
    setAnalyticsConsent(false)
    assert.equal(beforeSend({ url }), null)
  })
})
