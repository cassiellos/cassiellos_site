import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideLeadRoute, dispatchLeadToMeta,
  type LeadCapiContext, type LeadCapiGate, type LeadCapiStore,
} from './meta-lead-capi'
import type { CapiConfig, DeliveryUpdate, FetchLike } from './meta-capi'

const TOKEN = 'EAAfake_test_token_only_123456789000'
const PIXEL = '1234567890123456'
const LIVE: CapiConfig = { mode: 'live', pixelId: PIXEL, accessToken: TOKEN, apiVersion: 'v26.0', testEventCode: null }
const TEST: CapiConfig = { ...LIVE, mode: 'test' }
const ID = 'lead_123456781234423482341234567890ab'
const NOW = Date.parse('2026-11-18T14:00:00Z')
const IP = '203.0.113.11'
const UA = 'Mozilla/5.0 (synthetic privacy-safe test agent)'

function context(over: Partial<LeadCapiContext> = {}): LeadCapiContext {
  return {
    trackingId: '12345678-1234-4234-8234-123456789001',
    leadId: '12345678-1234-4234-8234-123456789002',
    event_id: ID,
    event_name: 'Lead',
    occurred_at: new Date(NOW - 5_000),
    event_source_url: 'https://crm.cassiellos.com.br/formularios/hamburguerias',
    metadata: { isTest: false, formSlug: 'hamburguerias' },
    leadIsTest: false,
    ...over,
  }
}
const allowed: LeadCapiGate = { leadIsTest: false, consentGranted: true }

function memoryStore(ctx: LeadCapiContext | null, gates: LeadCapiGate[] = [allowed]) {
  const deliveries = new Map<string, { id: string; stored: Record<string, unknown>; attempts: number; updates: DeliveryUpdate[] }>()
  let reads = 0
  const store: LeadCapiStore = {
    loadContext: async () => ctx,
    readGate: async () => gates[Math.min(reads++, gates.length - 1)],
    claimDelivery: async (trackingId, payload) => {
      if (deliveries.has(trackingId)) return null
      const id = 'delivery_' + deliveries.size
      deliveries.set(trackingId, { id, stored: payload, attempts: 0, updates: [] })
      return id
    },
    markAttempt: async id => {
      for (const v of deliveries.values()) if (v.id === id) v.attempts++
    },
    finish: async (id, update) => {
      for (const v of deliveries.values()) if (v.id === id) v.updates.push(update)
    },
  }
  return { store, deliveries, reads: () => reads }
}
function fakeFetch(statuses: number[]) {
  const calls: URLSearchParams[] = []
  const fetch: FetchLike = async (_url, init) => {
    const body = new URLSearchParams(init.body)
    calls.push(body)
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)]
    return { status, json: async () => status === 200 ? { events_received: 1 } : { error: { code: 1 } } }
  }
  return { calls, fetch }
}
const input = { eventId: ID, userAgent: UA, clientIp: IP }
const deps = (store: LeadCapiStore, fetch: FetchLike, config: CapiConfig = LIVE) =>
  ({ store, fetch, config, now: () => NOW, sleep: async () => undefined })

describe('Meta CAPI Lead — proteção, consentimento e deduplicação', () => {
  it('não permite envio no modo test/off ou quando lead não é real', () => {
    assert.equal(decideLeadRoute(TEST, context(), allowed, NOW).allowed, false)
    assert.equal(decideLeadRoute({ mode: 'off', reason: 'disabled' }, context(), allowed, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context({ leadIsTest: true }), allowed, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context({ metadata: { isTest: true } }), allowed, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context(), { ...allowed, leadIsTest: true }, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context(), { ...allowed, consentGranted: false }, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context({ event_name: 'Chronos_Scheduled' }), allowed, NOW).allowed, false)
    assert.equal(decideLeadRoute(LIVE, context({ occurred_at: new Date(NOW - 8 * 86_400_000) }), allowed, NOW).allowed, false)
  })
  it('entrega Lead pelo servidor com o MESMO event_id do Pixel e sem PII persistida', async () => {
    const m = memoryStore(context())
    const api = fakeFetch([200])
    const result = await dispatchLeadToMeta(deps(m.store, api.fetch), input)
    assert.equal(result.status, 'accepted')
    assert.equal(api.calls.length, 1)
    const wire = JSON.parse(api.calls[0].get('data')!)[0]
    assert.equal(wire.event_name, 'Lead')
    assert.equal(wire.event_id, ID)
    assert.equal(wire.event_source_url, 'https://crm.cassiellos.com.br/formularios/hamburguerias')
    assert.equal(wire.user_data.client_ip_address, IP)
    assert.equal(wire.user_data.client_user_agent, UA)
    assert.equal(api.calls[0].get('access_token'), TOKEN)
    const record = [...m.deliveries.values()][0]
    assert.deepEqual(record.updates.map(x => x.status), ['accepted'])
    for (const secret of [IP, UA, TOKEN, '@', 'fbclid', 'fbp', 'fbc', 'whatsapp', '"em"', '"ph"']) {
      assert.equal(JSON.stringify(record.stored).includes(secret), false, secret)
    }
    const repeated = await dispatchLeadToMeta(deps(m.store, api.fetch), input)
    assert.equal(repeated.status, 'duplicate')
    assert.equal(api.calls.length, 1)
  })
  it('consentimento recusado não cria entrega nem faz chamada', async () => {
    const m = memoryStore(context(), [{ consentGranted: false, leadIsTest: false }])
    const api = fakeFetch([200])
    assert.equal((await dispatchLeadToMeta(deps(m.store, api.fetch), input)).status, 'skipped')
    assert.equal(api.calls.length, 0)
    assert.equal(m.deliveries.size, 0)
  })
  it('revogação antes de repetir cancela após a primeira tentativa', async () => {
    const m = memoryStore(context(), [allowed, { consentGranted: false, leadIsTest: false }])
    const api = fakeFetch([500, 200])
    const result = await dispatchLeadToMeta(deps(m.store, api.fetch), input)
    assert.equal(result.status, 'abandoned')
    assert.equal(api.calls.length, 1)
    assert.deepEqual([...m.deliveries.values()][0].updates.map(x => x.status), ['retry', 'abandoned'])
  })
  it('falha transitória é repetida de forma idempotente com mesmo event_id', async () => {
    const m = memoryStore(context())
    const api = fakeFetch([500, 200])
    assert.equal((await dispatchLeadToMeta(deps(m.store, api.fetch), input)).status, 'accepted')
    assert.equal(api.calls.length, 2)
    assert.equal(JSON.parse(api.calls[0].get('data')!)[0].event_id, JSON.parse(api.calls[1].get('data')!)[0].event_id)
    assert.deepEqual([...m.deliveries.values()][0].updates.map(x => x.status), ['retry', 'accepted'])
  })
  it('token ausente não habilita envio; sem user-agent bloqueia antes de consultar o banco', async () => {
    const m = memoryStore(context())
    const api = fakeFetch([200])
    assert.equal((await dispatchLeadToMeta(deps(m.store, api.fetch, { mode: 'off', reason: 'missing_token' }), input)).status, 'skipped')
    assert.equal((await dispatchLeadToMeta(deps(m.store, api.fetch), { ...input, userAgent: null })).status, 'skipped')
    assert.equal(api.calls.length, 0)
  })
})
