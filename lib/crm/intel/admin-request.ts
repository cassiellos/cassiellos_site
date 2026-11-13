/**
 * API ADMINISTRATIVA da Central de Inteligência (sem framework, testável) — mesmo modelo do Financeiro:
 * 1. só existe nos ambientes do CRM (lib/crm/runtime-env.ts) E com a flag própria MI_ENABLED=true (padrão: desligada;
 *    configuração separada do CRM comercial) — fora disso, 404;
 * 2. exige a sessão administrativa do CRM (401 sem sessão; nenhum dado é devolvido);
 * 3. ações (POST) exigem origem do próprio CRM + JSON + corpo pequeno (CSRF) e têm intervalo mínimo por conta.
 *
 * Nesta fase só há dados SIMULADOS: nenhuma credencial, nenhuma chamada a plataformas, nada gravado no banco.
 */
import type { HandlerResponse } from '../booking-intake-request'
import { isCrmRuntimeRequest, type CrmRuntimeRequestEnv } from '../runtime-env'
import { assertNoSecretsInPayload } from './credential-vault'
import { demoSnapshot, syncAsset, type IntelSnapshot } from './demo/snapshot'
import { isIntelEnabled } from './feature'
import { manualSyncAllowed } from './sync/engine'
import { buildIntelPayload, FilterError, parseIntelFilters } from './view-model'

export type IntelRequest = CrmRuntimeRequestEnv & {
  method: 'GET' | 'POST'
  /** MI_ENABLED (flag exclusiva da Central). */
  intelEnabled: string | undefined
  sessionValid: boolean
  originAllowed: boolean
  contentType: string | null
  rawBody?: string
  searchParams?: URLSearchParams
  actorRef: string
}

export type IntelDeps = {
  now?: () => Date
  snapshot?: (now: Date) => Promise<IntelSnapshot>
  log?: (event: string, details: Record<string, unknown>) => void
}

export const MAX_INTEL_BODY = 2_000
const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): HandlerResponse => ({ status, body: { error, ...extra } })


/** Limite global por processo para a atualização manual simulada (além do intervalo por conta). */
const manualWindow: number[] = []
const MANUAL_PER_MINUTE = 20

export async function handleIntelAdmin(deps: IntelDeps, req: IntelRequest): Promise<HandlerResponse> {
  if (!isCrmRuntimeRequest(req) || !isIntelEnabled(req.intelEnabled)) return bad('NOT_FOUND', 404)
  if (!req.sessionValid) return bad('UNAUTHORIZED', 401)
  const now = deps.now?.() ?? new Date()
  const log = deps.log ?? ((event: string, details: Record<string, unknown>) => console.info(JSON.stringify({ scope: 'marketing_intel', event, ...details })))
  const getSnapshot = deps.snapshot ?? demoSnapshot

  if (req.method === 'GET') {
    let snap: IntelSnapshot
    try { snap = await getSnapshot(now) } catch { log('snapshot_failed', {}); return bad('INTEL_UNAVAILABLE', 503) }
    try {
      const filters = parseIntelFilters(req.searchParams ?? new URLSearchParams(), snap.dataset.clients)
      const payload = buildIntelPayload(snap, filters, now)
      assertNoSecretsInPayload(payload)
      return { status: 200, body: { ok: true, simulated: true, ...payload } }
    } catch (error) {
      if (error instanceof FilterError) return bad(error.code, error.code === 'CLIENT_NOT_FOUND' ? 404 : 400)
      log('build_failed', { reason: error instanceof Error ? error.name : 'unknown' })
      return bad('INTEL_UNAVAILABLE', 503)
    }
  }

  if (req.method !== 'POST') return bad('METHOD_NOT_ALLOWED', 405)
  if (!req.originAllowed) return bad('FORBIDDEN', 403)
  if (!(req.contentType ?? '').toLowerCase().startsWith('application/json')) return bad('UNSUPPORTED_MEDIA_TYPE', 415)
  const raw = req.rawBody ?? ''
  if (raw.length > MAX_INTEL_BODY) return bad('PAYLOAD_TOO_LARGE', 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return bad('INVALID_REQUEST') }
  if (!body || typeof body !== 'object') return bad('INVALID_REQUEST')
  const { action, assetId } = body as { action?: unknown; assetId?: unknown }
  if (action !== 'simulate_sync') return bad('UNKNOWN_ACTION')
  if (typeof assetId !== 'string' || !/^ast_[a-z0-9_]{3,60}$/.test(assetId)) return bad('INVALID_REQUEST')
  const snap = await getSnapshot(now)
  const asset = snap.dataset.assets.find(a => a.id === assetId)
  if (!asset) return bad('NOT_FOUND', 404)
  if (!asset.connectionId) return bad('ASSET_NOT_CONNECTED', 409)
  const gate = manualSyncAllowed(snap.manualAt.get(asset.id) ?? null, now)
  if (!gate.allowed) return bad('SYNC_TOO_SOON', 429, { retryAt: gate.retryAt })
  while (manualWindow.length && manualWindow[0] < now.getTime() - 60_000) manualWindow.shift()
  if (manualWindow.length >= MANUAL_PER_MINUTE) return bad('SYNC_TOO_SOON', 429, { retryAt: new Date(manualWindow[0] + 60_000).toISOString() })
  manualWindow.push(now.getTime())
  snap.manualAt.set(asset.id, now.toISOString())
  const run = await syncAsset(snap, asset, () => now, 'manual', false)
  log('manual_sync_simulated', { asset: asset.id, status: run?.status ?? 'none', actor: req.actorRef.slice(0, 12) })
  return { status: 200, body: { ok: true, simulated: true, run: run && { status: run.status, attempts: run.attempts, rows: run.rowsInserted + run.rowsUpdated + run.rowsUnchanged,
    inserted: run.rowsInserted, updated: run.rowsUpdated, unchanged: run.rowsUnchanged, error: run.errorMessage, finishedAt: run.finishedAt } } }
}

/** Somente testes. */
export function resetIntelRateWindow() { manualWindow.length = 0 }
