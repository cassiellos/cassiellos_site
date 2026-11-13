/**
 * API ADMINISTRATIVA do MODO REAL da Central (sem framework, testável). Mesmas proteções do modo demonstração
 * (ambiente do CRM + MI_ENABLED + sessão do CRM; ações exigem origem do CRM + JSON + corpo pequeno) e mais:
 * - toda alteração vai ao banco com trilha de auditoria (ator = referência da sessão administrativa);
 * - nada sai do servidor com segredo (`assertNoSecretsInPayload` em toda resposta);
 * - atualização manual com limites PERSISTENTES (por conta e global), lease distribuído e só para contas com vínculo
 *   CONFIRMADO ao cliente informado, conexão ativa e plataforma habilitada.
 */
import { randomUUID } from 'node:crypto'
import type { HandlerResponse } from '../../booking-intake-request'
import { isCrmRuntimeRequest } from '../../runtime-env'
import type { AdAccountInfo, AdsReadConnector } from '../connectors/contracts'
import { assertNoSecretsInPayload } from '../credential-vault'
import { addDays, civilDateInZone, syncWindow } from '../dates'
import { isIntelEnabled } from '../feature'
import { authorizeSync } from '../sync/eligibility'
import { DAILY_LOOKBACK_DAYS, MANUAL_MIN_INTERVAL_MS, syncAdsAsset } from '../sync/engine'
import { PgSyncStore } from '../sync/pg-store'
import { hitWindow, reserveInterval } from '../sync/rate-limit'
import { buildIntelPayload, FilterError, parseIntelFilters } from '../view-model'
import { MAX_INTEL_REAL_BODY, type IntelRequest } from '../admin-request'
import { googleStatus, metaStatus, providerReady } from './config'
import { createOAuthState, googleAuthorizeUrl, metaAuthorizeUrl } from './oauth'
import * as repo from './repo'
import type { RealRuntime } from './runtime'
import { loadRealSnapshot } from './snapshot'

export type RealDeps = { runtime: RealRuntime; now?: () => Date; log?: (event: string, details: Record<string, unknown>) => void; owner?: string }

/** Histórico inicial importado na primeira sincronização de uma conta (dias). */
export const INITIAL_BACKFILL_DAYS = 90
export const MANUAL_GLOBAL_PER_MINUTE = 20
const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): HandlerResponse => ({ status, body: { error, ...extra } })
const REPO_STATUS: Record<repo.RepoError['code'], number> = { INVALID: 400, NOT_FOUND: 404, CONFLICT: 409, ASSET_ALREADY_OWNED: 409, FINANCE_ALREADY_LINKED: 409, ARCHIVED: 409 }

async function adminBlock(rt: RealRuntime) {
  const [clients, financeClients, connections, assets, associations, audit] = await Promise.all([
    repo.listClients(rt.db, { includeArchived: true }), repo.listFinanceClients(rt.db), repo.listConnections(rt.db), repo.listAssets(rt.db),
    repo.listAssociations(rt.db), repo.recentAudit(rt.db, 30)])
  const g = googleStatus(rt.env), m = metaStatus(rt.env)
  return {
    clients, financeClients, connections, assets, associations, audit,
    providers: {
      google: { enabled: g.enabled, configured: g.configured, missing: g.missing, vault: !!rt.vault },
      meta: { enabled: m.enabled, configured: m.configured, missing: m.missing, vault: !!rt.vault, systemUserAvailable: !!rt.env.MI_META_SYSTEM_USER_TOKEN },
    },
    rules: { manualIntervalMinutes: MANUAL_MIN_INTERVAL_MS / 60_000, manualGlobalPerMinute: MANUAL_GLOBAL_PER_MINUTE, initialBackfillDays: INITIAL_BACKFILL_DAYS },
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined)

export async function handleIntelReal(deps: RealDeps, req: IntelRequest): Promise<HandlerResponse> {
  if (!isCrmRuntimeRequest(req) || !isIntelEnabled(req.intelEnabled)) return bad('NOT_FOUND', 404)
  if (!req.sessionValid) return bad('UNAUTHORIZED', 401)
  const rt = deps.runtime
  const now = deps.now?.() ?? new Date()
  const log = deps.log ?? ((event: string, details: Record<string, unknown>) => console.info(JSON.stringify({ scope: 'marketing_intel_real', event, ...details })))
  const actor = 'crm_admin:' + req.actorRef.slice(0, 16)

  if (req.method === 'GET') {
    try {
      const snap = await loadRealSnapshot(rt.db, now)
      const params = req.searchParams ?? new URLSearchParams()
      const area = params.get('area')
      const admin = area === 'cliente' || area === 'conexoes' ? await adminBlock(rt) : undefined
      let payload
      try { payload = buildIntelPayload(snap, parseIntelFilters(params, snap.dataset.clients), now) } catch (e) {
        // Modo real sem nenhum cliente externo cadastrado: a área Cliente mostra só o cadastro (nenhum número).
        if (e instanceof FilterError && e.code === 'CLIENT_NOT_FOUND' && area === 'cliente' && !params.get('client') && !snap.dataset.clients.some(c => c.kind === 'client' && c.status !== 'archived')) {
          const body = { ok: true, simulated: false, mode: 'real', area: 'cliente', view: null, admin }
          assertNoSecretsInPayload(body)
          return { status: 200, body }
        }
        if (e instanceof FilterError && e.code === 'CLIENT_NOT_FOUND' && area === 'prospeccao') {
          const body = { ok: true, simulated: false, mode: 'real', area: 'prospeccao', view: null, needsAgency: true }
          return { status: 200, body }
        }
        throw e
      }
      const body = { ok: true, simulated: false, mode: 'real', ...payload, admin }
      assertNoSecretsInPayload(body)
      return { status: 200, body }
    } catch (error) {
      if (error instanceof FilterError) return bad(error.code, error.code === 'CLIENT_NOT_FOUND' ? 404 : 400)
      log('real_read_failed', { reason: error instanceof Error ? error.name : 'unknown' })
      return bad('INTEL_UNAVAILABLE', 503)
    }
  }

  if (req.method !== 'POST') return bad('METHOD_NOT_ALLOWED', 405)
  if (!req.originAllowed) return bad('FORBIDDEN', 403)
  if (!(req.contentType ?? '').toLowerCase().startsWith('application/json')) return bad('UNSUPPORTED_MEDIA_TYPE', 415)
  if ((req.rawBody ?? '').length > MAX_INTEL_REAL_BODY) return bad('PAYLOAD_TOO_LARGE', 413)
  let body: Record<string, unknown>
  try { const parsed = JSON.parse(req.rawBody ?? ''); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('INVALID_REQUEST'); body = parsed } catch { return bad('INVALID_REQUEST') }

  try {
    switch (body.action) {
      case 'ensure_agency': return ok({ client: await repo.ensureAgencyClient(rt.db, actor) })
      case 'create_client': return ok({ client: await repo.createClient(rt.db, actor, { name: body.name, notes: body.notes, financeClientId: body.financeClientId }) })
      case 'update_client': return ok({ client: await repo.updateClient(rt.db, actor, String(body.clientId ?? ''), { name: body.name, notes: body.notes, status: body.status, financeClientId: body.financeClientId }) })
      case 'archive_client': await repo.archiveClient(rt.db, actor, String(body.clientId ?? '')); return ok({})
      case 'propose_link': return ok({ association: await repo.proposeAssociation(rt.db, actor, String(body.clientId ?? ''), String(body.assetId ?? ''), str(body.note, 500) ?? '') })
      case 'confirm_link': return ok({ association: await repo.confirmAssociation(rt.db, actor, String(body.clientId ?? ''), String(body.assetId ?? ''), str(body.sharedJustification, 500) ?? null) })
      case 'end_link': await repo.endAssociation(rt.db, actor, String(body.clientId ?? ''), String(body.assetId ?? '')); return ok({})
      case 'revoke_connection': {
        if (!rt.vault) return bad('VAULT_NOT_CONFIGURED', 409)
        await repo.revokeConnection(rt.db, rt.vault, actor, String(body.connectionId ?? ''))
        rt.googleTokens?.forget(String(body.connectionId ?? ''))
        return ok({})
      }
      case 'start_oauth': {
        const provider = body.provider === 'google' ? 'google' : body.provider === 'meta' ? 'meta' : null
        if (!provider) return bad('INVALID_REQUEST')
        const status = provider === 'google' ? googleStatus(rt.env) : metaStatus(rt.env)
        if (!providerReady(status) || !rt.ring) return bad('PROVIDER_NOT_READY', 409, { enabled: status.enabled, missing: status.missing })
        const state = await createOAuthState(rt.db, provider, actor, now)
        log('oauth_started', { provider })
        return ok({ url: provider === 'google' ? googleAuthorizeUrl(rt.env, rt.ring, state) : metaAuthorizeUrl(rt.env, state) })
      }
      case 'connect_meta_system_user': {
        const token = rt.env.MI_META_SYSTEM_USER_TOKEN
        if (!token || !rt.vault || !providerReady(metaStatus(rt.env))) return bad('PROVIDER_NOT_READY', 409)
        const meta = await rt.vault.store({ connectionId: 'system-user', provider: 'meta', secret: token, scopes: ['ads_read'], expiresAt: null })
        const conn = await repo.createConnection(rt.db, actor, { provider: 'meta', authKind: 'system_user', label: 'Meta · usuário do sistema', credentialRef: meta.ref, scopes: ['ads_read'], principalHint: null, expiresAt: null })
        return ok({ connection: conn })
      }
      case 'discover': {
        const conn = await repo.getConnection(rt.db, String(body.connectionId ?? ''))
        if (!conn) return bad('NOT_FOUND', 404)
        if (conn.status !== 'active') return bad('CONNECTION_NOT_ACTIVE', 409)
        const connector = conn.provider === 'google' ? rt.google : rt.meta
        if (!connector) return bad('PROVIDER_NOT_READY', 409)
        const accounts = await discoverAll(connector, conn.id)
        const count = await repo.upsertDiscoveredAccounts(rt.db, actor, conn.id, accounts)
        await repo.markConnection(rt.db, conn.id, 'active', null)
        return ok({ discovered: count })
      }
      case 'sync_now': return await syncNow(deps, rt, now, actor, String(body.clientId ?? ''), String(body.assetId ?? ''), log)
      default: return bad('UNKNOWN_ACTION')
    }
  } catch (error) {
    if (error instanceof repo.RepoError) return bad(error.code, REPO_STATUS[error.code])
    const kind = (error as { kind?: string }).kind
    if (kind) { log('real_action_failed', { action: String(body.action).slice(0, 30), kind }); return bad('PLATFORM_' + kind.toUpperCase(), kind === 'rate_limited' ? 429 : 502) }
    log('real_action_failed', { action: String(body.action).slice(0, 30), reason: error instanceof Error ? error.name : 'unknown' })
    return bad('INTEL_UNAVAILABLE', 503)
  }

  function ok(extra: Record<string, unknown>): HandlerResponse {
    const out = { ok: true, ...extra }
    assertNoSecretsInPayload(out)
    return { status: 200, body: out }
  }
}

async function discoverAll(connector: AdsReadConnector, connectionId: string): Promise<AdAccountInfo[]> {
  const out: AdAccountInfo[] = []
  let token: string | null = null
  let pages = 0
  do {
    const page = await connector.listAccessibleAccounts({ connectionId }, token)
    out.push(...page.items)
    token = page.nextPageToken
  } while (token && ++pages < 20)
  return out
}

async function syncNow(deps: RealDeps, rt: RealRuntime, now: Date, actor: string, clientId: string, assetId: string, log: NonNullable<RealDeps['log']>): Promise<HandlerResponse> {
  if (!repo.isUuid(clientId) || !repo.isUuid(assetId)) return bad('INVALID_REQUEST')
  const snap = await loadRealSnapshot(rt.db, now)
  const asset = snap.dataset.assets.find(a => a.id === assetId)
  if (!asset || !snap.dataset.links.some(l => l.clientId === clientId && l.assetId === assetId && l.status === 'confirmed')) return bad('ASSET_NOT_IN_CLIENT', 403)
  const decision = authorizeSync(asset, snap.dataset.links, snap.dataset.connections, 'manual', snap.store.observations.get(asset.id)?.accountStatus)
  if (!decision.eligible) return bad('SYNC_NOT_ALLOWED', 409, { reason: decision.reason })
  const connector = asset.platform === 'google_ads' ? rt.google : asset.platform === 'meta_ads' ? rt.meta : null
  if (!connector) return bad('PROVIDER_NOT_READY', 409)
  const global = await hitWindow(rt.db, 'manual_sync_global', now, 60_000, MANUAL_GLOBAL_PER_MINUTE)
  if (!global.allowed) return bad('SYNC_TOO_SOON', 429, { retryAt: global.retryAt })
  const gate = await reserveInterval(rt.db, 'manual_sync:' + assetId, now, MANUAL_MIN_INTERVAL_MS)
  if (!gate.allowed) return bad('SYNC_TOO_SOON', 429, { retryAt: gate.retryAt })
  const first = !snap.store.runs.some(r => r.assetId === assetId && r.status === 'succeeded')
  const today = civilDateInZone(now, asset.timeZone ?? 'America/Sao_Paulo')
  const range = first ? { start: addDays(today, -INITIAL_BACKFILL_DAYS), end: addDays(today, -1) } : syncWindow(today, DAILY_LOOKBACK_DAYS)
  const run = await syncAdsAsset({ store: new PgSyncStore(rt.db), now: () => new Date(), sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 5_000))), owner: deps.owner ?? 'crm-' + randomUUID().slice(0, 8),
    newRunId: randomUUID, maxAttempts: 3 }, connector, decision.target, range, first ? 'backfill' : 'manual')
  await repo.audit(rt.db, actor, 'manual_sync', 'sync_job', run.id, { assetId, status: run.status, rows: run.rowsInserted + run.rowsUpdated + run.rowsUnchanged })
  log('manual_sync', { status: run.status, kind: run.errorKind })
  const out = { ok: true, storage: 'database', run: { status: run.status, attempts: run.attempts, rows: run.rowsInserted + run.rowsUpdated + run.rowsUnchanged, inserted: run.rowsInserted,
    updated: run.rowsUpdated, unchanged: run.rowsUnchanged, error: run.errorMessage, finishedAt: run.finishedAt, range }, nextAllowedAt: new Date(now.getTime() + MANUAL_MIN_INTERVAL_MS).toISOString() }
  assertNoSecretsInPayload(out)
  return { status: 200, body: out }
}
