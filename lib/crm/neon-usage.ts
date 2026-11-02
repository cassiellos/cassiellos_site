/**
 * Pure, restricted projection of Neon management metrics for the CRM sidebar.
 * No API key, user data, database table names or billing secrets enter this payload.
 *
 * Sources (GET only, Neon API v2 — checked against the official reference on 2026-11-02):
 * - GET /projects/{id}: compute_time_seconds (CPU/CU-seconds), data_transfer_bytes (egress bytes),
 *   consumption_period_start/end, branch_logical_size_limit_bytes, owner.subscription_type.
 * - GET /projects/{id}/branches: branch.logical_size (bytes) of the PREVIEW branch.
 * The usage-based endpoints /consumption_history/v2/* are not available on the Free plan, and the
 * project fields synthetic_storage_size / data_storage_bytes_hour are deprecated (always 0), so
 * billed project storage is NOT available here. Storage shown is the logical size of the Preview
 * branch against Neon's per-branch logical size limit — never the project's billed storage.
 */
export type UsageQuantity = { used: number | null; limit: number | null }

export type NeonPlan = 'Free' | 'Free (legado)' | 'Outro' | 'Não informado'

export type NeonUsageSnapshot = {
  status: 'ready'
  projectName: string
  plan: NeonPlan
  updatedAt: string
  periodStart: string | null
  periodEnd: string | null
  /** CU-hours in the current Neon consumption period. */
  compute: UsageQuantity
  /** Bytes: logical size of the Preview branch vs. per-branch logical size limit. */
  storagePreview: UsageQuantity
  /** Bytes: project egress in the current Neon consumption period. */
  outboundTransfer: UsageQuantity
}

export type NeonUsageResult =
  | NeonUsageSnapshot
  | { status: 'not_configured' | 'unavailable' }

type Obj = Record<string, unknown>

/** Neon Console and plan allowances use decimal units (1 GB = 10^9 bytes, 1 MB = 10^6 bytes). */
export const DECIMAL_GB = 1000 ** 3

/**
 * Free plan allowances per project and month, from https://neon.com/docs/introduction/plans
 * (100 CU-hours, 5 GB public network transfer). Only applied to the current Free plan (free_v3).
 */
export const FREE_V3_ALLOWANCES = { computeCuHours: 100, transferBytes: 5 * DECIMAL_GB } as const

/** Manual refresh may bypass the 15-minute server cache, but never more than once a minute. */
export const CACHE_TTL_MS = 15 * 60 * 1000
export const MANUAL_REFRESH_MIN_INTERVAL_MS = 60 * 1000

const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
const dateString = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null

export function planFromSubscription(subscription: unknown): NeonPlan {
  if (subscription === 'free_v3') return 'Free'
  if (subscription === 'free_v2') return 'Free (legado)'
  if (typeof subscription === 'string' && subscription.length > 0 && subscription !== 'UNKNOWN') return 'Outro'
  return 'Não informado'
}

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
  const plan = planFromSubscription(owner.subscription_type)
  // Known allowances only for the current Free plan; anything else stays "not informed".
  const allowances = plan === 'Free' ? FREE_V3_ALLOWANCES : null
  const branches = branchesResponse.branches.filter(isObject)
  // Strict match by ID: never fall back to another branch with a similar name.
  const preview = branches.find(b => b.id === previewBranchId)
  // "1 CPU for 1 second = 1" per Neon reference: CU-weighted seconds -> CU-hours.
  const computeSeconds = finiteNonNegative(p.compute_time_seconds)
  const transferBytes = finiteNonNegative(p.data_transfer_bytes)
  const branchBytes = preview ? finiteNonNegative(preview.logical_size) : null
  // Per-branch logical size ceiling reported by Neon (bytes). No guessed fallback.
  const branchLimitBytes = finitePositive(p.branch_logical_size_limit_bytes)

  return {
    status: 'ready',
    projectName: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Cassiellos CRM',
    plan,
    updatedAt: measuredAt,
    periodStart: dateString(p.consumption_period_start),
    periodEnd: dateString(p.consumption_period_end),
    compute: {
      used: computeSeconds === null ? null : computeSeconds / 3600,
      limit: allowances ? allowances.computeCuHours : null,
    },
    storagePreview: { used: branchBytes, limit: branchLimitBytes },
    outboundTransfer: { used: transferBytes, limit: allowances ? allowances.transferBytes : null },
  }
}

/** Decide whether the server must call Neon again (cache TTL, or throttled manual refresh). */
export function shouldRefetch(fetchedAt: number | null, now: number, manual: boolean): boolean {
  if (fetchedAt === null) return true
  const age = now - fetchedAt
  if (age < 0) return true
  if (age >= CACHE_TTL_MS) return true
  return manual && age >= MANUAL_REFRESH_MIN_INTERVAL_MS
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

/** Highest alert level among metrics with a known limit. */
export function overallSeverity(metrics: UsageQuantity[]): 'normal' | 'warning' | 'critical' | 'unknown' {
  const levels = metrics.map(usageSeverity)
  if (levels.includes('critical')) return 'critical'
  if (levels.includes('warning')) return 'warning'
  if (levels.includes('normal')) return 'normal'
  return 'unknown'
}

/** Decimal byte formatting, matching the units displayed by the Neon Console. */
export function formatBytesDecimal(value: number): string {
  const fmt = (n: number, digits: number) =>
    n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  if (value >= DECIMAL_GB) return fmt(value / DECIMAL_GB, 2) + ' GB'
  if (value >= 1000 ** 2) return fmt(value / 1000 ** 2, 2) + ' MB'
  if (value >= 1000) return fmt(value / 1000, 1) + ' kB'
  return fmt(value, 0) + ' B'
}

/** Limits reported in binary multiples by Neon (e.g. 1073741824) are shown as GiB to avoid "1,07 GB". */
export function formatLimitBytes(value: number): string {
  const gib = 1024 ** 3
  if (value >= gib && value % gib === 0) return (value / gib).toLocaleString('pt-BR') + ' GiB'
  return formatBytesDecimal(value)
}
