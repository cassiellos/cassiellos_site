import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMetaServerEvent, type TrackingEventRow } from './meta-events'

/** Estado ATUAL do consentimento no CRM (readMarketingConsentState) no momento do envio. */
const consent = { granted: true }
const ids = { fbp: 'fb.1.1730000000000.1234567890', fbc: 'fb.1.1730000000000.IwAR0abcDEF_123' }
const schedule: TrackingEventRow = {
  event_id: 'chronos_scheduled_3f2b1c4d00004000800000000000abcd', event_name: 'Chronos_Scheduled',
  occurred_at: '2026-11-03T13:00:00.000Z', event_source_url: 'https://crm.cassiellos.com.br/agendar/odontologia',
  metadata: { formSlug: 'odontologia', environment: 'preview', isTest: false },
}

describe('Conversions API — preparação (nada é enviado)', () => {
  it('Chronos_Scheduled vira "Schedule" com o MESMO event_id do Pixel', () => {
    const r = buildMetaServerEvent(schedule, consent)
    assert.equal(r.allowed, true)
    assert.deepEqual(r.allowed && r.payload, {
      event_name: 'Schedule', event_time: 1793710800, event_id: schedule.event_id, action_source: 'website',
      event_source_url: 'https://crm.cassiellos.com.br/agendar/odontologia',
      user_data: {}, custom_data: { content_name: 'odontologia' },
    })
  })
  it('fbp/fbc só entram se forem passados no momento do envio (o CRM não os guarda) e válidos', () => {
    const r = buildMetaServerEvent(schedule, consent, ids)
    assert.deepEqual(r.allowed && r.payload.user_data, ids)
    const bad = buildMetaServerEvent(schedule, consent, { fbp: 'x', fbc: '<script>' })
    assert.deepEqual(bad.allowed && bad.payload.user_data, {})
  })
  it('Lead real com consentimento é aceito', () => {
    const r = buildMetaServerEvent({ ...schedule, event_id: 'lead_3f2b1c4d00004000800000000000abcd', event_name: 'Lead' }, consent)
    assert.equal(r.allowed && r.payload.event_name, 'Lead')
  })
  it('eventos de TESTE ou sem classificação nunca são enviados', () => {
    for (const metadata of [{ isTest: true }, {}, null, { isTest: 'false' }]) {
      assert.deepEqual(buildMetaServerEvent({ ...schedule, metadata }, consent), { allowed: false, reason: 'test_or_unclassified' })
    }
  })
  it('sem consentimento de marketing não há envio', () => {
    assert.deepEqual(buildMetaServerEvent(schedule, { granted: false }), { allowed: false, reason: 'no_marketing_consent' })
    assert.deepEqual(buildMetaServerEvent(schedule, undefined), { allowed: false, reason: 'no_marketing_consent' })
    assert.deepEqual(buildMetaServerEvent(schedule, null, ids), { allowed: false, reason: 'no_marketing_consent' })
  })
  it('eventos não mapeados são ignorados', () => {
    assert.deepEqual(buildMetaServerEvent({ ...schedule, event_name: 'Purchase' }, consent), { allowed: false, reason: 'unmapped_event' })
  })
  it('payload sem dados pessoais (sem e-mail, telefone ou nome) e URL sem parâmetros', () => {
    const r = buildMetaServerEvent({ ...schedule, event_source_url: 'https://crm.cassiellos.com.br/agendar/odontologia?email=x@y.com' },
      consent, { ...ids, email: 'maria@exemplo.com', phone: '31999999999' } as { fbp: string })
    assert.equal(r.allowed, true)
    const text = JSON.stringify(r)
    for (const pii of ['maria', '@', '3199999', 'em', 'ph']) {
      if (pii === 'em' || pii === 'ph') assert.equal(Object.keys(r.allowed ? r.payload.user_data : {}).includes(pii), false)
      else assert.equal(text.includes(pii), false, pii)
    }
    assert.equal(r.allowed && 'event_source_url' in r.payload, false)
  })
})
