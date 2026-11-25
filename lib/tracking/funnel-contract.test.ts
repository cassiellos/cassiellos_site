import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_FUNNEL_STAGE, TRACKING_EVENTS, flowStepOrder, formVersionLabel, isTrackingEvent, mapLegacyFunnelEvent,
  sanitizeTrackingParams, trackingDedupeKey,
} from './funnel-contract'
import { FUNNEL_EVENTS } from '../crm/funnel-events'
import { HAMBURGUERIAS_CHRONOS_DRAFT } from '../crm/form-builder/hamburguerias'

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
    const legacy = { form: 'hamburguerias', mode: 'live' }
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
      name: 'booking_meeting_confirmed', form: 'hamburguerias', mode: 'test', state: 'confirmed', days_ahead: 3, email: 'a@b.com',
    })
    assert.deepEqual(mapped?.params, { form_id: 'hamburguerias', environment_mode: 'test', funnel_stage: 'conclusion' })
    assert.equal(mapLegacyFunnelEvent({ name: 'outro', form: 'x', mode: 'live' }), null)
    assert.equal(mapLegacyFunnelEvent(null), null)
    assert.equal(mapLegacyFunnelEvent({ name: 'booking_form_view', form: 'x', mode: 'qualquer' }), null)
  })

  it('step_order: inteiro de 0 a 50, aceito no contrato; texto, negativo ou fracionado é descartado', () => {
    assert.equal(sanitizeTrackingParams({ ...base, step_order: 4 })?.step_order, 4)
    assert.equal(sanitizeTrackingParams({ ...base, step_order: 0 })?.step_order, 0)
    for (const bad of [-1, 51, 1.5, '3', null, NaN]) {
      assert.equal(sanitizeTrackingParams({ ...base, step_order: bad })?.step_order, undefined, String(bad))
    }
  })

  it('flowStepOrder: posição fixa por etapa, igual para todos os caminhos e sem usar respostas', () => {
    const order = flowStepOrder(HAMBURGUERIAS_CHRONOS_DRAFT.start, HAMBURGUERIAS_CHRONOS_DRAFT.steps)
    const ids = HAMBURGUERIAS_CHRONOS_DRAFT.steps.map(step => step.id)
    // Todas as etapas têm posição, sem repetição, de 0 até n-1.
    assert.deepEqual(Object.keys(order).sort(), [...ids].sort())
    assert.deepEqual(Object.values(order).sort((a, b) => a - b), ids.map((_, i) => i))
    // A primeira etapa é a posição 0 e as perguntas seguem a ordem do fluxo.
    assert.equal(order[HAMBURGUERIAS_CHRONOS_DRAFT.start], 0)
    const questions = HAMBURGUERIAS_CHRONOS_DRAFT.steps.filter(step => step.type === 'question')
    let previous = -1
    let id: string | undefined = HAMBURGUERIAS_CHRONOS_DRAFT.start
    while (id) {
      const step = HAMBURGUERIAS_CHRONOS_DRAFT.steps.find(item => item.id === id)
      if (!step || step.type !== 'question') break
      assert.ok(order[step.id] > previous, step.id + ' vem depois da anterior')
      previous = order[step.id]
      id = step.next
    }
    assert.ok(questions.length >= 5)
  })

  it('flowStepOrder com ramificação: o destino alcançável por dois caminhos tem uma posição só', () => {
    const steps = [
      { id: 'a', type: 'question', next: 'b', branches: [{ to: 'fim_limitado' }] },
      { id: 'b', type: 'question', next: 'fim_ok', branches: [{ to: 'fim_limitado' }] },
      { id: 'fim_ok', type: 'result' },
      { id: 'fim_limitado', type: 'result' },
      { id: 'solta', type: 'result' },
    ]
    const order = flowStepOrder('a', steps)
    assert.equal(order.a, 0)
    assert.equal(order.b, 1)
    // fim_limitado é alcançada já a partir de "a" (profundidade 1), fim_ok só de "b" (profundidade 2).
    assert.ok(order.fim_limitado < order.fim_ok)
    // Etapa inalcançável fica por último, sem quebrar.
    assert.equal(order.solta, 4)
    // Início inexistente não derruba o cálculo.
    assert.deepEqual(Object.keys(flowStepOrder('x', steps)).length, 5)
    // Ciclo não trava.
    assert.equal(flowStepOrder('a', [{ id: 'a', type: 'question', next: 'a' }]).a, 0)
  })

  it('legado do /agendar: step_order passa quando válido', () => {
    const mapped = mapLegacyFunnelEvent({ name: 'booking_step_completed', form: 'hamburguerias', mode: 'live', step: 'q_nome', step_index: 1, step_order: 1 })
    assert.equal(mapped?.params.step_order, 1)
  })
})
