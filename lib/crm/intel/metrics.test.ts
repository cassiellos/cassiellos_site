import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conversionCost, convertMicros, costPerConversionMicros, cplMicros, cpcMicros, cpmMicros, ctr, ratesFor, singleCurrencyTotal, summarizeAds, type AdsDailyFact,
} from './metrics'

const fact = (o: Partial<AdsDailyFact>): AdsDailyFact => ({ platform: 'google_ads', assetId: 'a', campaignId: 'c', day: '2026-11-01', currency: 'BRL',
  impressions: 0, clicks: 0, costMicros: 0, conversions: null, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta', ...o })

describe('Central — métricas', () => {
  it('CTR, CPC, CPM e CPL com as fórmulas definidas', () => {
    assert.deepEqual(ctr(50, 2000), { kind: 'value', value: 2.5 })
    assert.deepEqual(cpcMicros(125_000_000, 50), { kind: 'value', value: 2_500_000 })        // R$ 125 / 50 = R$ 2,50
    assert.deepEqual(cpmMicros(125_000_000, 2000), { kind: 'value', value: 62_500_000 })     // R$ 62,50 por mil
    assert.deepEqual(cplMicros(300_000_000, 12), { kind: 'value', value: 25_000_000 })       // R$ 25,00
    assert.deepEqual(costPerConversionMicros(100_000_000, 3), { kind: 'value', value: 33_333_333 })
  })
  it('denominador zero ≠ ausência de dados ≠ zero', () => {
    assert.deepEqual(ctr(0, 0), { kind: 'zero_denominator' })
    assert.deepEqual(cpcMicros(10_000_000, 0), { kind: 'zero_denominator' })
    assert.deepEqual(cplMicros(10_000_000, 0), { kind: 'zero_denominator' })
    assert.deepEqual(ctr(0, 1000), { kind: 'value', value: 0 })
    assert.deepEqual(ctr(null, 1000), { kind: 'no_data' })
    assert.deepEqual(cpmMicros(undefined, 1000), { kind: 'no_data' })
    assert.deepEqual(ratesFor(null).ctr, { kind: 'no_data' })
    assert.equal(summarizeAds([]).hasData, false)
    assert.equal(summarizeAds([fact({})]).hasData, true) // linha com zeros: há dado, e ele é zero
  })
  it('taxas sobre os totais agregados — nunca média simples dos percentuais das campanhas', () => {
    const rows = [fact({ campaignId: 'x', impressions: 100, clicks: 10, costMicros: 10_000_000 }),   // CTR 10%
      fact({ campaignId: 'y', impressions: 9900, clicks: 99, costMicros: 99_000_000 })]              // CTR 1%
    const s = summarizeAds(rows)
    const t = singleCurrencyTotal(s).total!
    assert.deepEqual(ratesFor(t).ctr, { kind: 'value', value: 1.09 })  // 109/10000 — e não (10+1)/2 = 5,5%
    assert.deepEqual(ratesFor(t).cpcMicros, { kind: 'value', value: 1_000_000 })
  })
  it('precisão monetária: soma em micros inteiros, sem erro de ponto flutuante', () => {
    const rows = Array.from({ length: 10 }, (_, i) => fact({ day: '2026-11-' + String(i + 1).padStart(2, '0'), costMicros: 100_000, clicks: 1, impressions: 10 })) // 10 × R$ 0,10
    const t = singleCurrencyTotal(summarizeAds(rows)).total!
    assert.equal(t.costMicros, 1_000_000) // exatamente R$ 1,00 (0.1 × 10 em float daria 0.9999999999999999)
  })
  it('moedas distintas não são somadas; total único só com uma moeda', () => {
    const s = summarizeAds([fact({ currency: 'BRL', costMicros: 5_000_000 }), fact({ currency: 'USD', costMicros: 7_000_000, platform: 'meta_ads', conversionBasis: 'meta:actions:lead' })])
    assert.deepEqual(s.byCurrency.map(c => [c.currency, c.costMicros]), [['BRL', 5_000_000], ['USD', 7_000_000]])
    assert.equal(singleCurrencyTotal(s).total, null)
    assert.deepEqual(singleCurrencyTotal(s).currencies, ['BRL', 'USD'])
    assert.equal(convertMicros(1_000_000, 'USD', 'BRL', null), null)                        // sem taxa identificada → não converte
    assert.equal(convertMicros(1_000_000, 'USD', 'BRL', { from: 'USD', to: 'BRL', day: '2026-11-12', rate: 5.4, source: '' }), null) // sem fonte
    assert.equal(convertMicros(1_000_000, 'USD', 'BRL', { from: 'USD', to: 'BRL', day: '2026-11-12', rate: 5.4, source: 'teste' }), 5_400_000)
  })
  it('conversões de plataformas diferentes ficam em grupos separados (não são eventos únicos)', () => {
    const s = summarizeAds([
      fact({ platform: 'google_ads', conversions: 4, costMicros: 40_000_000 }),
      fact({ platform: 'meta_ads', conversionBasis: 'meta:actions:lead', attribution: 'meta:7d_click,1d_view', conversions: 6, costMicros: 30_000_000 }),
    ])
    assert.equal(s.conversions.length, 2)
    assert.deepEqual(s.conversions.map(g => [g.platform, g.conversions]), [['google_ads', 4], ['meta_ads', 6]])
    assert.ok(!('totalConversions' in s), 'não existe total de conversões entre plataformas')
    assert.deepEqual(conversionCost(s.conversions[0]), { kind: 'value', value: 10_000_000 })
    assert.deepEqual(conversionCost(s.conversions[1]), { kind: 'value', value: 5_000_000 })
  })
  it('conversões não reportadas (null) ≠ zero conversões', () => {
    const naoReportadas = summarizeAds([fact({ conversions: null, costMicros: 9_000_000 })]).conversions[0]
    const zero = summarizeAds([fact({ conversions: 0, costMicros: 9_000_000 })]).conversions[0]
    assert.deepEqual(conversionCost(naoReportadas), { kind: 'no_data' })
    assert.deepEqual(conversionCost(zero), { kind: 'zero_denominator' })
  })
  it('conversões fracionárias somadas sem erro de arredondamento', () => {
    const s = summarizeAds([fact({ conversions: 0.1 }), fact({ day: '2026-11-02', conversions: 0.2 })])
    assert.equal(s.conversions[0].conversions, 0.3)
  })
})
