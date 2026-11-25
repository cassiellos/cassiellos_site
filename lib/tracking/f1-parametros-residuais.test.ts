import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { pushTrackingEvent } from './datalayer-client'
import {
  OPTIONAL_TRACKING_PARAM_KEYS, TRACKING_EVENTS, sanitizeTrackingParams, toDataLayerEvent, type TrackingEventName,
} from './funnel-contract'
import { setAnalyticsConsent } from '../privacy/consent-client'

/*
 * F1 — parâmetros residuais. O modelo de dados do GTM MESCLA cada push: uma chave que o push seguinte não menciona continua com
 * o valor anterior; uma chave com `undefined` é apagada. Aqui o modelo é simulado e cada evento é lido como o GTM o veria.
 */
const store = new Map<string, string>()
const win = new EventTarget() as EventTarget & Record<string, unknown>
Object.assign(win, {
  location: new URL('https://crm.cassiellos.com.br/formularios/hamburguerias'),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
})
Object.assign(globalThis, { window: win, document: { cookie: '', referrer: '' } })
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const REQUIRED = ['form_id', 'environment_mode']
const layer = () => (win.dataLayer as Record<string, unknown>[] | undefined) ?? []

/** Variáveis da camada de dados como o GTM as veria no momento do último push (merge; undefined apaga). */
function gtmModel(pushes: Record<string, unknown>[]): Record<string, unknown> {
  const model: Record<string, unknown> = {}
  for (const push of pushes) for (const [key, value] of Object.entries(push)) {
    if (value === undefined) delete model[key]; else model[key] = value
  }
  return model
}
const base = { form_id: 'hamburguerias', environment_mode: 'test', form_version: 'v3', flow_variant: 'cover' }
const push = (name: TrackingEventName, extra: Record<string, unknown> = {}, ref: string | null = null) =>
  pushTrackingEvent(name, { ...base, ...extra }, ref, { dedupe: false })

describe('F1 — nenhum parâmetro opcional é herdado do evento anterior', () => {
  beforeEach(() => { delete win.dataLayer; store.clear(); setAnalyticsConsent(true) })

  it('a lista de opcionais cobre TODO parâmetro que o contrato aceita (um parâmetro novo sem entrar na lista reprova aqui)', () => {
    const all = sanitizeTrackingParams({
      form_id: 'hamburguerias', environment_mode: 'live', form_version: 'v1', step_id: 'q1', step_index: 1, step_order: 1,
      step_type: 'question', funnel_stage: 'questions', flow_variant: 'cover', validation_error_code: 'REQUIRED',
    })!
    assert.deepEqual(Object.keys(all).filter(key => !REQUIRED.includes(key)).sort(), [...OPTIONAL_TRACKING_PARAM_KEYS].sort())
    for (const key of ['step_id', 'step_index', 'step_order', 'step_type', 'validation_error_code']) {
      assert.ok((OPTIONAL_TRACKING_PARAM_KEYS as readonly string[]).includes(key), key)
    }
  })

  it('todo push traz TODAS as chaves opcionais (valor ou undefined explícito); form_id e environment_mode sempre presentes', () => {
    for (const name of TRACKING_EVENTS) {
      const event = toDataLayerEvent(name, { form_id: 'hamburguerias', environment_mode: 'live' })
      for (const key of OPTIONAL_TRACKING_PARAM_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(event, key), `${name}: falta reinicializar ${key}`)
        assert.equal(event[key], undefined, `${name}.${key}`)
      }
      assert.equal(event.event, name)
      assert.equal(event.form_id, 'hamburguerias')
    }
  })

  it('erro de validação de uma pergunta NÃO vaza para o lead (tentativa, lead gerado) nem para o calendário', () => {
    const question = { step_id: 'q_whats', step_index: 2, step_order: 2, step_type: 'question', funnel_stage: 'questions' }
    assert.equal(push('form_validation_error', { ...question, validation_error_code: 'INVALID_PHONE' }), true)
    assert.equal(gtmModel(layer()).validation_error_code, 'INVALID_PHONE')
    const contact = { step_id: 'resultado', step_index: 4, step_order: 4, step_type: 'contact', funnel_stage: 'capture' }
    assert.equal(push('lead_submit_attempt', contact, 'k1'), true)
    assert.equal(gtmModel(layer()).validation_error_code, undefined, 'tentativa não herda o erro')
    assert.equal(push('generate_lead', contact, 'k1'), true)
    const lead = gtmModel(layer())
    assert.equal(lead.validation_error_code, undefined, 'lead gerado não herda o erro anterior')
    assert.equal(lead.step_id, 'resultado', 'o que é pertinente ao evento atual permanece')
    assert.equal(lead.step_type, 'contact')
  })

  it('evento do calendário NÃO herda step_id, step_index, step_order nem step_type da pergunta', () => {
    push('form_step_complete', { step_id: 'q_whats', step_index: 2, step_order: 2, step_type: 'question', funnel_stage: 'questions' })
    push('form_validation_error', { step_id: 'q_whats', step_index: 2, step_order: 2, step_type: 'question', validation_error_code: 'REQUIRED' })
    for (const name of ['booking_calendar_view', 'booking_date_selected', 'booking_slots_loaded', 'booking_slot_selected', 'booking_submit_attempt', 'booking_meeting_confirmed'] as const) {
      assert.equal(push(name, { step_type: 'calendar', funnel_stage: name === 'booking_submit_attempt' || name === 'booking_meeting_confirmed' ? 'conclusion' : 'calendar' }, 'ref-' + name), true)
      const model = gtmModel(layer())
      for (const key of ['step_id', 'step_index', 'step_order', 'validation_error_code']) {
        assert.equal(model[key], undefined, `${name} herdou ${key}`)
      }
      assert.equal(model.step_type, 'calendar', `${name}: step_type é o do próprio evento`)
    }
  })

  it('erro de agenda com código próprio não deixa o código para a confirmação seguinte', () => {
    push('booking_calendar_load_error', { step_type: 'calendar', funnel_stage: 'calendar', validation_error_code: 'CALENDAR_UNAVAILABLE' })
    assert.equal(gtmModel(layer()).validation_error_code, 'CALENDAR_UNAVAILABLE')
    push('booking_meeting_confirmed', { step_type: 'calendar', funnel_stage: 'conclusion' }, 'r')
    assert.equal(gtmModel(layer()).validation_error_code, undefined)
  })

  it('propriedade: qualquer evento B depois de qualquer evento A enxerga SÓ os parâmetros do próprio push', () => {
    const everything = { step_id: 'q1', step_index: 1, step_order: 1, step_type: 'question', funnel_stage: 'questions', validation_error_code: 'REQUIRED' }
    for (const a of TRACKING_EVENTS) for (const b of TRACKING_EVENTS) {
      delete win.dataLayer
      push(a, everything)
      push(b, { funnel_stage: 'entry' })
      const model = gtmModel(layer())
      for (const key of ['step_id', 'step_index', 'step_order', 'step_type', 'validation_error_code']) {
        assert.equal(model[key], undefined, `${a} → ${b}: ${key} vazou`)
      }
      assert.equal(model.form_id, 'hamburguerias')
      assert.equal(model.event, b)
    }
  })

  it('o detalhe do evento local (cassiellos:track) continua só com os parâmetros presentes, sem chaves undefined', () => {
    let detail: Record<string, unknown> | null = null
    win.addEventListener('cassiellos:track', event => { detail = (event as CustomEvent).detail })
    push('form_view', { step_type: 'cover' })
    assert.deepEqual(detail, { name: 'form_view', ...base, step_type: 'cover' })
  })
})
