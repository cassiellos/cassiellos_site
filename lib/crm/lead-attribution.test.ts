/**
 * Atribuição por lead: a PRIMEIRA origem válida é a principal; envios posteriores sem UTM não a apagam; a origem
 * mais recente fica separada. Testes puros (sem banco).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attributionFields, hasMarketingOrigin, LEAD_ATTRIBUTION_JOINS, resolveLeadAttribution } from './lead-attribution'

const sub = (id: string, at: string, attribution: Record<string, unknown> | null) => ({ id, submittedAt: at, attribution })
const META = { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'diagnostico_nov' }
const GOOGLE = { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'busca_marca' }

describe('atribuição por lead (primeira origem válida + mais recente)', () => {
  it('lead de campanha que envia outro formulário SEM UTM continua com a origem da campanha', () => {
    const r = resolveLeadAttribution([sub('a', '2026-11-01T10:00:00Z', META), sub('b', '2026-11-03T10:00:00Z', {})])
    assert.equal(r.primary?.source, 'meta')
    assert.equal(r.primary?.campaign, 'diagnostico_nov')
    assert.equal(r.primary?.at, '2026-11-01T10:00:00.000Z')
    assert.equal(r.latest?.source, 'meta', 'a mais recente VÁLIDA também é a campanha')
  })
  it('primeiro envio sem UTM e depois com UTM: a origem válida vira a principal', () => {
    const r = resolveLeadAttribution([sub('a', '2026-11-01T10:00:00Z', null), sub('b', '2026-11-02T10:00:00Z', GOOGLE)])
    assert.equal(r.primary?.source, 'google')
  })
  it('duas campanhas diferentes: principal = primeira; mais recente = última, separada', () => {
    const r = resolveLeadAttribution([
      sub('c', '2026-11-04T10:00:00Z', {}), sub('b', '2026-11-03T10:00:00Z', GOOGLE), sub('a', '2026-11-01T10:00:00Z', META)])
    assert.deepEqual([r.primary?.source, r.latest?.source], ['meta', 'google'])
    assert.equal(r.latest?.at, '2026-11-03T10:00:00.000Z')
  })
  it('nenhum envio com UTM: origem não identificada (null)', () => {
    assert.deepEqual(resolveLeadAttribution([sub('a', '2026-11-01T10:00:00Z', {}), sub('b', '2026-11-02T10:00:00Z', null)]), { primary: null, latest: null })
    assert.deepEqual(resolveLeadAttribution([]), { primary: null, latest: null })
  })
  it('valores vazios, espaços, só utm_content/utm_term ou só fbclid não contam como origem', () => {
    for (const a of [{ utm_source: '' }, { utm_source: '   ' }, { utm_content: 'x' }, { utm_term: 'y' }, { fbclid: 'z' }, { utm_source: 5 }]) {
      assert.equal(hasMarketingOrigin(a as Record<string, unknown>), false, JSON.stringify(a))
    }
    assert.equal(hasMarketingOrigin({ utm_campaign: 'so_campanha' }), true)
  })
  it('empate de data: desempate por id (mesma ordem do SQL)', () => {
    const r = resolveLeadAttribution([sub('b', '2026-11-01T10:00:00Z', GOOGLE), sub('a', '2026-11-01T10:00:00Z', META)])
    assert.deepEqual([r.primary?.source, r.latest?.source], ['meta', 'google'])
  })
  it('não altera os registros recebidos', () => {
    const list = [sub('b', '2026-11-03T10:00:00Z', {}), sub('a', '2026-11-01T10:00:00Z', { ...META })]
    const before = JSON.stringify(list)
    resolveLeadAttribution(list)
    assert.equal(JSON.stringify(list), before)
  })
  it('SQL: somente leitura, primeira em ordem crescente e mais recente em ordem decrescente', () => {
    assert.equal(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(LEAD_ATTRIBUTION_JOINS), false)
    assert.match(LEAD_ATTRIBUTION_JOINS, /ORDER BY f\.submitted_at ASC, f\.id ASC LIMIT 1\s*\) first_attr/)
    assert.match(LEAD_ATTRIBUTION_JOINS, /ORDER BY f\.submitted_at DESC, f\.id DESC LIMIT 1\s*\) latest_attr/)
  })
  it('formato da API: source/medium/campaign = principal; latest* = mais recente', () => {
    const f = attributionFields({ utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'c1', attribution_at: new Date('2026-11-01T10:00:00Z'),
      latest_utm_source: 'google', latest_utm_medium: 'cpc', latest_utm_campaign: 'c2', latest_attribution_at: new Date('2026-11-03T10:00:00Z') })
    assert.deepEqual(f, { source: 'meta', medium: 'paid_social', campaign: 'c1', attributedAt: '2026-11-01T10:00:00.000Z',
      latestSource: 'google', latestMedium: 'cpc', latestCampaign: 'c2', latestAttributedAt: '2026-11-03T10:00:00.000Z' })
  })
})
