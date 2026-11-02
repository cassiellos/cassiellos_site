/**
 * Pure, restricted projection of Neon management metrics for the CRM sidebar.
 * No API key, user data, database table names or billing secrets enter this payload.
 * Storage is the logical size of the PREVIEW branch, not billing usage for all branches.
 */
export type UsageQuantity = { used: number | null; limit: number | null }

export type NeonUsageSnapshot = {
  status: 'ready'
  projectName: string
  plan: 'Free' | 'Outro'
  updatedAt: string
  periodStart: string | null
  periodEnd: string | null
  compute: UsageQuantity
  storagePreview: UsageQuantity
  outboundTransfer: UsageQuantity
}

export type NeonUsageResult =
  | NeonUsageSnapshot
  | { status: 'not_configured' | 'unavailable' }

type Obj = Record<string, unknown>
const GIB = 1024 ** 3
const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const dateString = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null

export function projectUsageFromNeon(
  projectResponse: unknown,
  branchesResponse: unknown,
  projectId: string,
  previewBranchId: string,
  measuredAt: string,
): NeonUsageSnapshot | null {
  if (!isObject(projectResponse) || !isObject(projectResponse.project) ||
      !isObject(branchesResponse) || !Array.isArray(branchesResponse.branches)) return null
  const p = projectResponse.project
  if (p.id !== projectId) return null
  const owner = isObject(p.owner) ? p.owner : {}
  const isFree = owner.subscription_type === 'free_v3' || owner.subscription_type === 'free'
  const branches = branchesResponse.branches.filter(isObject)
  const preview = branches.find(b => b.id === previewBranchId) ??
    branches.find(b => b.name === 'preview')
  const computeSeconds = finiteNonNegative(p.compute_time_seconds)
  const transferBytes = finiteNonNegative(p.data_transfer_bytes)
  const branchBytes = preview ? finiteNonNegative(preview.logical_size) : null
  // Per-branch size ceiling supplied by Neon; do not confuse it with billed project storage.
  const storageLimitBytes = finiteNonNegative(p.branch_logical_size_limit_bytes)

  return {
    status: 'ready',
    projectName: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Cassiellos CRM',
    plan: isFree ? 'Free' : 'Outro',
    updatedAt: measuredAt,
    periodStart: dateString(p.consumption_period_start),
    periodEnd: dateString(p.consumption_period_end),
    compute: {
      // Neon already weights these seconds by compute size: CU-seconds -> CU-hours.
      used: computeSeconds === null ? null : computeSeconds / 3600,
      limit: isFree ? 100 : null,
    },
    storagePreview: { used: branchBytes, limit: storageLimitBytes ?? (isFree ? GIB : null) },
    outboundTransfer: { used: transferBytes, limit: isFree ? 5 * GIB : null },
  }
}

export function usagePercent(metric: UsageQuantity): number | null {
  if (metric.used === null || metric.limit === null || metric.limit <= 0) return null
  return Math.max(0, Math.min(100, metric.used / metric.limit * 100))
}

export function usageSeverity(metric: UsageQuantity): 'normal' | 'warning' | 'critical' | 'unknown' {
  const percent = usagePercent(metric)
  if (percent === null) return 'unknown'
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'normal'
}
