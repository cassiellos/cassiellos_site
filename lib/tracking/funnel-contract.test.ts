import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_FUNNEL_STAGE, TRACKING_EVENTS, formVersionLabel, isTrackingEvent, mapLegacyFunnelEvent,
  sanitizeTrackingParams, trackingDedupeKey,
} from './funnel-contract'
import { FUNNEL_EVENTS } from '../crm/funnel-events'

const base = { form_id: 'hamburguerias', environment_mode: 'live' }

describe('contrato de eventos do funil (dataLayer → GA4)', () => {
  it('traz exatamente os eventos do plano de mensuração, sem duplicados', () => {
    assert.deepEqual([...TRACKING_EVENTS], [
      'form_view', 'form_start', 'form_cover_cta_click',
      'form_step_view', 'form_step_complete', 'form_step_back', 'form_validation_error',
      'lead_submit_attempt', 'generate_lead', 'lead_submit_error',
      'booking_calendar_view', 'booking_calendar_load_error', 'booking_date_selected', 'booking_slots_loaded',
      'booking_no_slots', 'booking_slot_selected',
      'booking_submit_attempt', 'booking_meeting_confirmed', 'booking_confirmation_error',
    ])
    assert.equal(new Set(TRACKING_EVENTS).size, TRACKING_EVENTS.length)
    assert.equal(isTrackingEvent('generate_lead'), true)
    assert.equal(isTrackingEvent('purchase'), false)
    for (const name of TRACKING_EVENTS) assert.ok(DEFAULT_FUNNEL_STAGE[name], name)
  })

  it('só os parâmetros permitidos sobrevivem; qualquer outro campo (inclusive pessoal) é descartado', () => {
    const params = sanitizeTrackingParams({
      ...base, form_version: 'v3', step_id: 'q_faturamento', step_index: 2, step_type: 'question', funnel_stage: 'questions',
      flow_variant: 'cover', validation_error_code: 'invalid_phone',
      email: 'maria@x.com', phone: '31999999999', name: 'Maria', answer: 'Acima de R$ 300 mil/mês',
      answers: { a: 'b' }, meet_url: 'https://meet.google.com/abc-defg-hij', date: '2026-11-25', slot: '10:00',
    })
    assert.deepEqual(params, {
      form_id: 'hamburguerias', environment_mode: 'live', form_version: 'v3', step_id: 'q_faturamento', step_index: 2,
      step_type: 'question', funnel_stage: 'questions', flow_variant: 'cover', validation_error_code: 'INVALID_PHONE',
    })
    const text = JSON.stringify(params)
    for (const leak of ['maria', '3199', 'Acima', 'meet.google', '2026-11-25', '10:00']) assert.equal(text.includes(leak), false, leak)
  })

  it('valores com cara de dado pessoal são descartados em cada parâmetro', () => {
    const params = sanitizeTrackingParams({
      ...base, step_id: 'maria@x.com', validation_error_code: 'Preencha esta resposta', step_index: 2.5,
      step_type: 'Meu texto', funnel_stage: 'qualquer', flow_variant: 'x', form_version: '3',
    })
    assert.deepEqual(params, { form_id: 'hamburguerias', environment_mode: 'live' })
    assert.equal(sanitizeTrackingParams({ ...base, step_id: 'telefone31999998888' })?.step_id, undefined)
  })

  it('sem formulário ou com modo inválido o evento é descartado', () => {
    assert.equal(sanitizeTrackingParams({ environment_mode: 'live' }), null)
    assert.equal(sanitizeTrackingParams({ form_id: 'hamburguerias' }), null)
    assert.equal(sanitizeTrackingParams({ form_id: 'hamburguerias', environment_mode: 'production' }), null)
    assert.equal(sanitizeTrackingParams({ form_id: 'a b', environment_mode: 'live' }), null)
  })

  it('versão do fluxo vira "vN" e valores estranhos são ignorados', () => {
    assert.equal(formVersionLabel(7), 'v7')
    assert.equal(formVersionLabel('7'), undefined)
    assert.equal(formVersionLabel(-1), undefined)
    assert.equal(formVersionLabel(1.5), undefined)
  })

  it('deduplicação: entrada/calendário uma vez por formulário, etapa uma vez por etapa, envio e reunião por referência', () => {
    const p = sanitizeTrackingParams({ ...base, step_id: 'q1' })!
    assert.equal(trackingDedupeKey('form_view', p), 'form_view:hamburguerias')
    assert.equal(trackingDedupeKey('form_step_view', p), 'form_step_view:hamburguerias:q1')
    assert.equal(trackingDedupeKey('form_step_view', sanitizeTrackingParams(base)!), null)
    assert.equal(trackingDedupeKey('generate_lead', p), null, 'sem referência não há como deduplicar')
    const a = trackingDedupeKey('booking_meeting_confirmed', p, 'booking-1')
    assert.ok(a && a.startsWith('booking_meeting_confirmed:hamburguerias:'))
    assert.equal(a, trackingDedupeKey('booking_meeting_confirmed', p, 'booking-1'))
    assert.notEqual(a, trackingDedupeKey('booking_meeting_confirmed', p, 'booking-2'))
    assert.equal(a!.includes('booking-1'), false, 'a chave não expõe a referência')
    const e = sanitizeTrackingParams({ ...base, validation_error_code: 'too_many_requests' })!
    assert.equal(trackingDedupeKey('lead_submit_error', e), 'lead_submit_error:hamburguerias:TOO_MANY_REQUESTS')
  })

  it('cada etapa do plano mapeia para a etapa do funil esperada', () => {
    assert.equal(DEFAULT_FUNNEL_STAGE.form_view, 'entry')
    assert.equal(DEFAULT_FUNNEL_STAGE.form_step_complete, 'questions')
    assert.equal(DEFAULT_FUNNEL_STAGE.generate_lead, 'capture')
    assert.equal(DEFAULT_FUNNEL_STAGE.booking_slot_selected, 'calendar')
    assert.equal(DEFAULT_FUNNEL_STAGE.booking_meeting_confirmed, 'conclusion')
  })
})

describe('mapeamento determinístico dos eventos existentes do /agendar', () => {
  it('todo evento antigo tem destino definido, e erros seguem a etapa em que ocorreram', () => {
    const legacy = { form: 'odontologia', mode: 'live' }
    const expected: Record<string, string> = {
      booking_form_view: 'form_view', booking_form_start: 'form_start', booking_step_completed: 'form_step_complete',
      booking_form_submit: 'lead_submit_attempt', booking_lead_registered: 'generate_lead',
      booking_slot_selected: 'booking_slot_selected', booking_meeting_confirmed: 'booking_meeting_confirmed',
    }
    for (const name of FUNNEL_EVENTS) {
      if (name === 'booking_form_error') continue
      assert.equal(mapLegacyFunnelEvent({ name, ...legacy })?.name, expected[name], name)
    }
    const err = (stage: string) => mapLegacyFunnelEvent({ name: 'booking_form_error', ...legacy, stage, code: 'sem_horario' })
    assert.equal(err('question')?.name, 'form_validation_error')
    assert.equal(err('lead')?.name, 'lead_submit_error')
    assert.equal(err('availability')?.name, 'booking_calendar_load_error')
    assert.equal(err('confirm')?.name, 'booking_confirmation_error')
    assert.equal(err('lead')?.params.funnel_stage, 'capture')
    assert.equal(err('lead')?.params.validation_error_code, 'SEM_HORARIO')
    assert.equal(mapLegacyFunnelEvent({ name: 'booking_form_error', ...legacy }), null)
  })

  it('copia só parâmetros permitidos (state e days_ahead não viram parâmetro) e rejeita entradas inválidas', () => {
    const mapped = mapLegacyFunnelEvent({
      name: 'booking_meeting_confirmed', form: 'odontologia', mode: 'test', state: 'confirmed', days_ahead: 3, email: 'a@b.com',
    })
    assert.deepEqual(mapped?.params, { form_id: 'odontologia', environment_mode: 'test', funnel_stage: 'conclusion' })
    assert.equal(mapLegacyFunnelEvent({ name: 'outro', form: 'x', mode: 'live' }), null)
    assert.equal(mapLegacyFunnelEvent(null), null)
    assert.equal(mapLegacyFunnelEvent({ name: 'booking_form_view', form: 'x', mode: 'qualquer' }), null)
  })
})
