import 'server-only'

import { projectUsageFromNeon, type NeonUsageResult, type NeonUsageSnapshot } from './neon-usage'

const NEON_API = 'https://console.neon.tech/api/v2'
const PROJECT_DEFAULT = 'rough-cloud-13370615'
const PREVIEW_BRANCH_DEFAULT = 'br-solitary-darkness-b67vm982'
const TTL_MS = 15 * 60 * 1000
const TIMEOUT_MS = 8000

// Cache is per server process only. Nothing is persisted to PostgreSQL or sent to public caches.
let cached: { value: NeonUsageSnapshot; fetchedAt: number } | null = null
let inflight: Promise<NeonUsageResult> | null = null

async function neonGet(path: string, key: string): Promise<unknown> {
  const response = await fetch(NEON_API + path, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('NEON_USAGE_UNAVAILABLE')
  return response.json()
}

/**
 * Project-scoped organization API key preferred. Never exposes or logs the key,
 * raw Neon API response, branch metadata or admin details.
 */
export async function readNeonUsage(): Promise<NeonUsageResult> {
  const key = process.env.NEON_USAGE_API_KEY?.trim()
  if (!key) return { status: 'not_configured' }
  const projectId = process.env.NEON_USAGE_PROJECT_ID?.trim() || PROJECT_DEFAULT
  const previewId = process.env.NEON_USAGE_PREVIEW_BRANCH_ID?.trim() || PREVIEW_BRANCH_DEFAULT
  if (!/^[-a-z0-9]{5,80}$/.test(projectId) || !/^br-[-a-z0-9]{5,80}$/.test(previewId)) {
    return { status: 'unavailable' }
  }
  const now = Date.now()
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.value
  if (inflight) return inflight
  inflight = (async (): Promise<NeonUsageResult> => {
    try {
      const [project, branches] = await Promise.all([
        neonGet('/projects/' + encodeURIComponent(projectId), key),
        neonGet('/projects/' + encodeURIComponent(projectId) + '/branches', key),
      ])
      const value = projectUsageFromNeon(project, branches, projectId, previewId, new Date().toISOString())
      if (!value) return { status: 'unavailable' }
      cached = { value, fetchedAt: Date.now() }
      return value
    } catch {
      // Do not leak access errors, project IDs, stack traces, or API response bodies.
      return { status: 'unavailable' }
    } finally {
      inflight = null
    }
  })()
  return inflight
}
