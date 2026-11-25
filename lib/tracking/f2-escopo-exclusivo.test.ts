import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { TRACKING_SCOPE_PATHS, isTrackingScopeForm, mapLegacyFunnelEvent, sanitizeTrackingParams } from './funnel-contract'
import { getGtmFormConfig, getGtmFormConfigForSlug } from './gtm-config'
import { pushTrackingEvent } from './datalayer-client'
import { setAnalyticsConsent } from '../privacy/consent-client'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const ENV = { TRACKING_GTM_ENABLED: 'true', GTM_FORM_CONTAINER_ID: 'GTM-T7JCRBW4' }
const NOT_IN_SCOPE = [
  'hamburguerias-2', 'hamburguerias_2', 'hamburgueria', 'hamburguerias2', 'hamburguerias-teste', 'minha-hamburguerias', 'Hamburguerias',
  'HAMBURGUERIAS', 'hamburguerias ', ' hamburguerias', 'hamburguerias/', 'hamburguerias/x', 'hamburguerias?x=1', 'hamburguerias#a',
  'hamburguerias%2F', 'hamburguerias%20', '../hamburguerias', 'hamburguerias.', 'odontologia', 'agendar', 'pizzarias', 'x', '',
]

describe('F2 — escopo exclusivo: só /formularios/hamburguerias (correspondência exata)', () => {
  it('a rota do escopo é exatamente uma', () => {
    assert.deepEqual([...TRACKING_SCOPE_PATHS], ['/formularios/hamburguerias'])
  })

  it('isTrackingScopeForm aceita só o slug exato e recusa slugs parecidos, variações de caixa/espaço/codificação e não-textos', () => {
    assert.equal(isTrackingScopeForm('hamburguerias'), true)
    for (const slug of NOT_IN_SCOPE) assert.equal(isTrackingScopeForm(slug), false, JSON.stringify(slug))
    for (const value of [null, undefined, 0, {}, [], ['hamburguerias']]) assert.equal(isTrackingScopeForm(value), false)
  })

  it('o contrato descarta todo evento de outro formulário', () => {
    assert.ok(sanitizeTrackingParams({ form_id: 'hamburguerias', environment_mode: 'live' }))
    for (const slug of NOT_IN_SCOPE) assert.equal(sanitizeTrackingParams({ form_id: slug, environment_mode: 'live' }), null, JSON.stringify(slug))
    assert.equal(mapLegacyFunnelEvent({ name: 'booking_form_view', form: 'odontologia', mode: 'live' }), null, 'ponte do /agendar também')
  })

  it('o GTM só é configurado para o slug exato, e só com as duas variáveis; os demais ficam desligados mesmo com o contêiner configurado', () => {
    assert.deepEqual(getGtmFormConfigForSlug('hamburguerias', ENV), { enabled: true, containerId: 'GTM-T7JCRBW4' })
    for (const slug of NOT_IN_SCOPE) assert.deepEqual(getGtmFormConfigForSlug(slug, ENV), { enabled: false }, JSON.stringify(slug))
    assert.deepEqual(getGtmFormConfigForSlug('hamburguerias', {}), { enabled: false })
    assert.deepEqual(getGtmFormConfigForSlug('hamburguerias', { ...ENV, TRACKING_GTM_ENABLED: 'false' }), { enabled: false })
    assert.deepEqual(getGtmFormConfig(ENV), { enabled: true, containerId: 'GTM-T7JCRBW4' }, 'a configuração genérica não mudou')
  })

  describe('emissor no navegador', () => {
    const store = new Map<string, string>()
    const win = new EventTarget() as EventTarget & Record<string, unknown>
    Object.assign(win, {
      location: new URL('https://crm.cassiellos.com.br/formularios/outro'),
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    })
    Object.assign(globalThis, { window: win, document: { cookie: '', referrer: '' } })
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch
    beforeEach(() => { delete win.dataLayer; store.clear(); setAnalyticsConsent(true) })

    it('com consentimento, outro formulário não escreve nada no dataLayer; o do escopo escreve', () => {
      for (const slug of ['hamburguerias-2', 'odontologia', 'Hamburguerias']) {
        assert.equal(pushTrackingEvent('form_view', { form_id: slug, environment_mode: 'live' }), false, slug)
      }
      assert.equal(win.dataLayer, undefined)
      assert.equal(pushTrackingEvent('form_view', { form_id: 'hamburguerias', environment_mode: 'live' }), true)
      assert.equal(((win.dataLayer ?? []) as unknown[]).length, 1)
    })
  })

  it('no código: a página usa a configuração POR SLUG canônico e nenhum outro lugar liga o GTM', () => {
    const page = read('app/formularios/[slug]/page.tsx')
    assert.match(page, /getGtmFormConfigForSlug\(doc\.slug\)/)
    assert.doesNotMatch(page, /getGtmFormConfig\(\)/)
    assert.doesNotMatch(page, /getGtmFormConfig\b(?!ForSlug)/)
    const flow = read('app/formularios/[slug]/public-flow.tsx')
    assert.match(flow, /<GoogleTagManager containerId=\{gtmContainerId\}\/>/)
    for (const file of ['app/agendar/[slug]/page.tsx', 'app/agendar/[slug]/booking-experience.tsx', 'app/layout.tsx']) {
      try { assert.doesNotMatch(read(file), /GoogleTagManager|getGtmFormConfig/, file) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  })
})
