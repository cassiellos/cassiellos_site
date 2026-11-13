import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertReadOnlyRequest, isReadOnlyGaql, ReadOnlyViolation } from './read-only-guard'

describe('Central — conectores somente leitura', () => {
  it('Google Ads: só ListAccessibleCustomers e Search/SearchStream com GAQL SELECT', () => {
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'google_ads', service: 'CustomerService', method: 'ListAccessibleCustomers' }))
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'google_ads', service: 'GoogleAdsService', method: 'Search', query: "SELECT campaign.id, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-07'" }))
    for (const [service, method] of [['GoogleAdsService', 'Mutate'], ['CampaignService', 'MutateCampaigns'], ['CampaignBudgetService', 'MutateCampaignBudgets'], ['AdGroupAdService', 'MutateAdGroupAds']])
      assert.throws(() => assertReadOnlyRequest({ platform: 'google_ads', service, method }), ReadOnlyViolation)
    assert.throws(() => assertReadOnlyRequest({ platform: 'google_ads', service: 'GoogleAdsService', method: 'Search', query: 'SELECT campaign.id FROM campaign; DELETE x' }), ReadOnlyViolation)
    assert.equal(isReadOnlyGaql("SELECT campaign.name FROM campaign WHERE campaign.name = 'update promo'"), true) // palavra em literal não conta
    assert.equal(isReadOnlyGaql('mutate campaign'), false)
  })
  it('Meta: só GET em leitura (e o POST de relatório assíncrono de insights)', () => {
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'GET', path: '/v26.0/act_1234567890/insights?level=campaign' }))
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'GET', path: '/me/adaccounts' }))
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'POST', path: '/v26.0/act_1234567890/insights' }))
    assert.throws(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'POST', path: '/v26.0/act_1234567890/campaigns' }), ReadOnlyViolation)
    assert.throws(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'POST', path: '/v26.0/1234567890' }), ReadOnlyViolation) // atualizar campanha/anúncio
    assert.throws(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'DELETE', path: '/v26.0/1234567890' }), ReadOnlyViolation)
    assert.throws(() => assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'GET', path: '/v26.0/act_1234567890/customaudiences' }), ReadOnlyViolation)
  })
  it('GA4 e GTM: somente métodos de leitura', () => {
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'ga4', api: 'data', method: 'runReport' }))
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'ga4', api: 'admin', method: 'accountSummaries.list' }))
    assert.throws(() => assertReadOnlyRequest({ platform: 'ga4', api: 'admin', method: 'properties.patch' }), ReadOnlyViolation)
    assert.doesNotThrow(() => assertReadOnlyRequest({ platform: 'gtm', httpMethod: 'GET', resource: 'accounts/123/containers/456/versions:live' }))
    assert.throws(() => assertReadOnlyRequest({ platform: 'gtm', httpMethod: 'POST', resource: 'accounts/123/containers/456/versions/7:publish' }), ReadOnlyViolation)
  })
  it('os contratos e os mocks não expõem métodos de escrita nem importam SDKs de anúncios', () => {
    const dir = join(process.cwd(), 'lib/crm/intel')
    const files = ['connectors/contracts.ts', 'connectors/mock.ts', 'sync/engine.ts', 'view-model.ts', 'admin-request.ts', 'demo/snapshot.ts']
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      assert.doesNotMatch(src, /\b(mutate|createCampaign|updateCampaign|pauseCampaign|publish\(|setBudget)\b/i, f)
      assert.doesNotMatch(src, /from ['"](google-ads-api|facebook-nodejs-business-sdk|googleapis|@google-analytics)/, f)
    }
    assert.ok(readdirSync(join(dir, 'connectors')).includes('read-only-guard.ts'))
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@vercel/analytics', '@vercel/speed-insights', 'lenis', 'motion', 'next', 'pg', 'react', 'react-dom'], 'nenhuma dependência nova')
  })
})
