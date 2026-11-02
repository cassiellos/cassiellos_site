import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CACHE_TTL_MS, DECIMAL_GB, MANUAL_REFRESH_MIN_INTERVAL_MS, formatBytesDecimal, formatLimitBytes,
  overallSeverity, planFromSubscription, projectUsageFromNeon, shouldRefetch, usagePercent, usageSeverity,
} from './neon-usage'

const PROJECT = 'rough-cloud-13370615'
const PREVIEW = 'br-solitary-darkness-b67vm982'
const GIB = 1024 ** 3

// Shape and magnitudes mirror GET /projects/{id} for this Free project (no secrets, no owner e-mail).
function fixture() {
  return {
    project: {
      id: PROJECT, name: 'cassiellos-crm',
      compute_time_seconds: 1669, active_time_seconds: 6604, data_transfer_bytes: 2352088,
      synthetic_storage_size: 0, data_storage_bytes_hour: 0,
      consumption_period_start: '2026-11-01T00:00:00Z',
      consumption_period_end: '2026-12-01T00:00:00Z',
      branch_logical_size_limit: 1024,
      branch_logical_size_limit_bytes: GIB,
      owner: { subscription_type: 'free_v3' as string },
    },
  }
}
const branches = () => ({
  branches: [
    { id: PREVIEW, name: 'preview', parent_id: 'br-lingering-lake-b61iqqs9', logical_size: 35004416 },
    { id: 'br-lingering-lake-b61iqqs9', name: 'production', logical_size: 31686656 },
  ],
})

describe('Neon usage projection (only safe numbers)', () => {
  it('projects CU-hours, egress and Preview logical size without summing branches', () => {
    const result = projectUsageFromNeon(fixture(), branches(), PROJECT, PREVIEW, '2026-11-02T15:00:00Z')
    assert.ok(result)
    assert.equal(result.status, 'ready')
    assert.equal(result.plan, 'Free')
    assert.equal(result.compute.used, 1669 / 3600)
    assert.equal(result.compute.limit, 100)
    assert.equal(result.outboundTransfer.used, 2352088)
    assert.equal(result.outboundTransfer.limit, 5 * DECIMAL_GB)
    assert.equal(result.storagePreview.used, 35004416)
    assert.equal(result.storagePreview.limit, GIB)
    assert.equal(result.periodStart, '2026-11-01T00:00:00Z')
    assert.equal(result.periodEnd, '2026-12-01T00:00:00Z')
  })

  it('never uses deprecated zero-valued storage fields or guesses missing numbers', () => {
    const project = fixture()
    delete (project.project as Partial<typeof project.project>).data_transfer_bytes
    delete (project.project as Partial<typeof project.project>).branch_logical_size_limit_bytes
    const result = projectUsageFromNeon(project, { branches: [] }, PROJECT, PREVIEW, '2026-11-02T15:00:00Z')
    assert.ok(result)
    assert.equal(result.storagePreview.used, null)
    assert.equal(result.storagePreview.limit, null)
    assert.equal(result.outboundTransfer.used, null)
    assert.equal(usageSeverity(result.storagePreview), 'unknown')
  })

  it('matches the Preview branch strictly by ID, never by a similar name', () => {
    const result = projectUsageFromNeon(fixture(), { branches: [{ id: 'br-other-1234', name: 'preview', logical_size: 1 }] },
      PROJECT, PREVIEW, '2026-11-02T15:00:00Z')
    assert.ok(result)
    assert.equal(result.storagePreview.used, null)
  })

  it('rejects mismatched project identity or unexpected shapes', () => {
    assert.equal(projectUsageFromNeon(fixture(), { branches: [] }, 'other-project', PREVIEW, 'now'), null)
    assert.equal(projectUsageFromNeon({ project: null }, { branches: [] }, PROJECT, PREVIEW, 'now'), null)
    assert.equal(projectUsageFromNeon(fixture(), { branches: null }, PROJECT, PREVIEW, 'now'), null)
  })

  it('applies documented allowances only to the current Free plan', () => {
    assert.equal(planFromSubscription('free_v3'), 'Free')
    assert.equal(planFromSubscription('free_v2'), 'Free (legado)')
    assert.equal(planFromSubscription('launch_v3'), 'Outro')
    assert.equal(planFromSubscription('UNKNOWN'), 'Não informado')
    assert.equal(planFromSubscription(undefined), 'Não informado')
    for (const sub of ['launch_v3', 'free_v2']) {
      const project = fixture()
      project.project.owner.subscription_type = sub
      const result = projectUsageFromNeon(project, branches(), PROJECT, PREVIEW, '2026-11-02T15:00:00Z')
      assert.ok(result)
      assert.equal(result.compute.limit, null)
      assert.equal(result.outboundTransfer.limit, null)
    }
    const noOwner = fixture() as { project: Record<string, unknown> }
    delete noOwner.project.owner
    const result = projectUsageFromNeon(noOwner, branches(), PROJECT, PREVIEW, '2026-11-02T15:00:00Z')
    assert.ok(result)
    assert.equal(result.plan, 'Não informado')
    assert.equal(result.compute.limit, null)
  })

  it('shows 80% as warning, 95% as critical, never exceeds 100 visual percent', () => {
    assert.equal(usageSeverity({ used: 79.99, limit: 100 }), 'normal')
    assert.equal(usageSeverity({ used: 80, limit: 100 }), 'warning')
    assert.equal(usageSeverity({ used: 94.99, limit: 100 }), 'warning')
    assert.equal(usageSeverity({ used: 95, limit: 100 }), 'critical')
    assert.equal(usagePercent({ used: 110, limit: 100 }), 100)
    assert.equal(usagePercent({ used: 10, limit: 0 }), null)
    assert.equal(overallSeverity([{ used: 1, limit: 100 }, { used: 81, limit: 100 }]), 'warning')
    assert.equal(overallSeverity([{ used: 96, limit: 100 }, { used: 81, limit: 100 }]), 'critical')
    assert.equal(overallSeverity([{ used: null, limit: 100 }]), 'unknown')
  })

  it('formats bytes in decimal units like the Neon Console', () => {
    assert.equal(formatBytesDecimal(35004416), '35,00 MB')
    assert.equal(formatBytesDecimal(31686656), '31,69 MB')
    assert.equal(formatBytesDecimal(2352088), '2,35 MB')
    assert.equal(formatBytesDecimal(5 * DECIMAL_GB), '5,00 GB')
    assert.equal(formatLimitBytes(GIB), '1 GiB')
    assert.equal(formatLimitBytes(5 * DECIMAL_GB), '5,00 GB')
  })

  it('serves the 15-minute cache, letting manual refresh through at most once a minute', () => {
    const t0 = 1_000_000
    assert.equal(shouldRefetch(null, t0, false), true)
    assert.equal(shouldRefetch(t0, t0 + 5_000, false), false)
    assert.equal(shouldRefetch(t0, t0 + 5_000, true), false)
    assert.equal(shouldRefetch(t0, t0 + MANUAL_REFRESH_MIN_INTERVAL_MS, true), true)
    assert.equal(shouldRefetch(t0, t0 + MANUAL_REFRESH_MIN_INTERVAL_MS, false), false)
    assert.equal(shouldRefetch(t0, t0 + CACHE_TTL_MS, false), true)
  })
})
