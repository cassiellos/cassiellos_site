import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { projectUsageFromNeon, usagePercent, usageSeverity } from './neon-usage'

const PROJECT = 'rough-cloud-13370615'
const PREVIEW = 'br-solitary-darkness-b67vm982'
const GIB = 1024 ** 3

function fixture() {
  return {
    project: {
      id: PROJECT, name: 'cassiellos-crm',
      compute_time_seconds: 1055, data_transfer_bytes: 1235987,
      consumption_period_start: '2026-11-01T00:00:00Z',
      consumption_period_end: '2026-12-01T00:00:00Z',
      branch_logical_size_limit_bytes: GIB,
      owner: { subscription_type: 'free_v3' },
    },
  }
}

describe('Neon usage projection (only safe numbers)', () => {
  it('projects CU-hours, egress and Preview logical size without summing duplicated branches', () => {
    const project = fixture()
    const branches = {
      branches: [
        { id: 'br-production', name: 'production', logical_size: 31800000 },
        { id: PREVIEW, name: 'preview', logical_size: 35004416 },
      ],
    }
    const result = projectUsageFromNeon(project, branches, PROJECT, PREVIEW, '2026-11-02T11:00:00Z')
    assert.ok(result)
    assert.equal(result.status, 'ready')
    assert.equal(result.plan, 'Free')
    assert.equal(result.compute.used, 1055 / 3600)
    assert.equal(result.compute.limit, 100)
    assert.equal(result.outboundTransfer.used, 1235987)
    assert.equal(result.outboundTransfer.limit, 5 * GIB)
    assert.equal(result.storagePreview.used, 35004416)
    assert.equal(result.storagePreview.limit, GIB)
    assert.equal(result.periodStart, '2026-11-01T00:00:00Z')
  })

  it('never guesses usage when Neon omits numbers or Preview branch', () => {
    const project = fixture()
    delete (project.project as Partial<typeof project.project>).data_transfer_bytes
    const result = projectUsageFromNeon(project, { branches: [] }, PROJECT, PREVIEW, '2026-11-02T11:00:00Z')
    assert.ok(result)
    assert.equal(result.storagePreview.used, null)
    assert.equal(result.outboundTransfer.used, null)
    assert.equal(usageSeverity(result.storagePreview), 'unknown')
  })

  it('rejects mismatched project identity or unexpected shapes', () => {
    assert.equal(projectUsageFromNeon(fixture(), { branches: [] }, 'other-project', PREVIEW, 'now'), null)
    assert.equal(projectUsageFromNeon({ project: null }, { branches: [] }, PROJECT, PREVIEW, 'now'), null)
    assert.equal(projectUsageFromNeon(fixture(), { branches: null }, PROJECT, PREVIEW, 'now'), null)
  })

  it('leaves non-Free quotas unknown instead of inventing numbers', () => {
    const project = fixture()
    project.project.owner.subscription_type = 'launch'
    const result = projectUsageFromNeon(project, { branches: [] }, PROJECT, PREVIEW, '2026-11-02T11:00:00Z')
    assert.ok(result)
    assert.equal(result.plan, 'Outro')
    assert.equal(result.compute.limit, null)
    assert.equal(result.outboundTransfer.limit, null)
  })

  it('shows 80% as warning, 95% as critical, never exceeds 100 visual percent', () => {
    assert.equal(usageSeverity({ used: 79.99, limit: 100 }), 'normal')
    assert.equal(usageSeverity({ used: 80, limit: 100 }), 'warning')
    assert.equal(usageSeverity({ used: 94.99, limit: 100 }), 'warning')
    assert.equal(usageSeverity({ used: 95, limit: 100 }), 'critical')
    assert.equal(usagePercent({ used: 110, limit: 100 }), 100)
    assert.equal(usagePercent({ used: 10, limit: 0 }), null)
  })
})
