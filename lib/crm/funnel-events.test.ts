import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { daysAhead, funnelDedupeKey, funnelModeFor, isFunnelEvent, sanitizeFunnelProps, shortHash } from './funnel-events'

describe('funil — propriedades sem dados pessoais', () => {
  it('mantém só as chaves permitidas', () => {
    const props = sanitizeFunnelProps({
      form: 'odontologia', mode: 'test', step: 'priority', step_index: 2, stage: 'lead', code: 'INVALID_EMAIL',
      state: 'confirmed', days_ahead: 1, email: 'maria@clinica.com.br', name: 'Maria', whatsapp: '31999990000',
      leadId: '0b9f…', url: 'https://x/?gclid=1',
    })
    assert.deepEqual(props, {
      form: 'odontologia', mode: 'test', step: 'priority', step_index: 2, stage: 'lead', code: 'INVALID_EMAIL',
      state: 'confirmed', days_ahead: 1,
    })
  })
  it('descarta valores com e-mail, espaço, barra ou sequência de dígitos', () => {
    const props = sanitizeFunnelProps({
      form: 'odontologia', mode: 'live', step: 'maria@clinica.com.br', code: 'Failed to fetch', stage: 'outro',
      state: 'qualquer', days_ahead: -1, step_index: 3.5,
    })
    assert.deepEqual(props, { form: 'odontologia', mode: 'live' })
    assert.equal(sanitizeFunnelProps({ form: 'odontologia', mode: 'live', step: '31999990000' })?.step, undefined)
    assert.equal(sanitizeFunnelProps({ form: 'a/b', mode: 'live' }), null)
  })
  it('modo obrigatório: só "test" ou "live"', () => {
    assert.equal(sanitizeFunnelProps({ form: 'odontologia' }), null)
    assert.equal(sanitizeFunnelProps({ form: 'odontologia', mode: 'production' }), null)
  })
  it('lista fechada de eventos', () => {
    assert.equal(isFunnelEvent('booking_meeting_confirmed'), true)
    assert.equal(isFunnelEvent('Lead'), false)
  })
})

describe('funil — deduplicação', () => {
  const props = { form: 'odontologia', mode: 'test' as const }
  it('visualização e início: uma vez por formulário', () => {
    assert.equal(funnelDedupeKey('booking_form_view', props), funnelDedupeKey('booking_form_view', props))
    assert.notEqual(funnelDedupeKey('booking_form_view', props), funnelDedupeKey('booking_form_start', props))
  })
  it('lead e reunião: mesma referência = mesma chave; sem referência = não envia', () => {
    const a = funnelDedupeKey('booking_lead_registered', props, 'lead-1')
    assert.equal(a, funnelDedupeKey('booking_lead_registered', props, 'lead-1'))
    assert.notEqual(a, funnelDedupeKey('booking_lead_registered', props, 'lead-2'))
    assert.equal(funnelDedupeKey('booking_meeting_confirmed', props, null), null)
    assert.equal(funnelDedupeKey('booking_form_submit', props), null)
  })
  it('a chave guardada não contém o identificador interno', () => {
    const id = '5f0c2a52-8a43-4d43-9a4f-1d7f3e0b3a10'
    const key = funnelDedupeKey('booking_meeting_confirmed', props, id)!
    assert.equal(key.includes(id), false)
    assert.equal(key, 'booking_meeting_confirmed:odontologia:' + shortHash(id))
  })
  it('etapa e erro: por etapa / por etapa + código', () => {
    assert.notEqual(funnelDedupeKey('booking_step_completed', { ...props, step: 'clinic' }),
      funnelDedupeKey('booking_step_completed', { ...props, step: 'email' }))
    assert.equal(funnelDedupeKey('booking_step_completed', props), null)
    assert.notEqual(funnelDedupeKey('booking_form_error', { ...props, stage: 'lead', code: 'A' }),
      funnelDedupeKey('booking_form_error', { ...props, stage: 'confirm', code: 'A' }))
  })
})

describe('funil — teste × real', () => {
  it('"live" só em modo real e sem allowlist de teste', () => {
    assert.equal(funnelModeFor({ bookingMode: 'live', allowlistActive: false }), 'live')
    assert.equal(funnelModeFor({ bookingMode: 'live', allowlistActive: true }), 'test')
    assert.equal(funnelModeFor({ bookingMode: 'test', allowlistActive: false }), 'test')
    assert.equal(funnelModeFor({ bookingMode: '', allowlistActive: false }), 'test')
  })
  it('dias de antecedência sem data exata', () => {
    assert.equal(daysAhead('2026-10-30', '2026-11-03'), 4)
    assert.equal(daysAhead('2026-10-30', '2026-10-30'), 0)
    assert.equal(daysAhead('2026-10-30', '2026-10-29'), null)
    assert.equal(daysAhead('', '2026-10-29'), null)
  })
})
