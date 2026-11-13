/**
 * Central de Inteligência — MOTOR DE SINCRONIZAÇÃO (independe de framework; nesta fase roda só com conectores mock).
 *
 * - Uma execução = um ativo (conta Google Ads/Meta Ads, propriedade GA4 ou contêiner GTM) e uma janela de datas.
 * - Diário: revisão dos últimos 7 dias completos no fuso DA CONTA (as plataformas recontabilizam conversões).
 *   Reprocessamento de 30 dias previsto para execução semanal (fase futura; mesma função, outra janela).
 * - Idempotente: upsert por chave natural — repetir a mesma janela não duplica linhas.
 * - Lease por ativo: duas execuções simultâneas da mesma conta não acontecem (a segunda termina `skipped_locked`).
 * - Erros: `rate_limited` (429) espera Retry-After/backoff exponencial; `transient` tenta de novo com limite;
 *   autorização expirada/revogada ou sem permissão PARA imediatamente e abre alerta.
 * - Progresso por página: o que já foi gravado fica; falha no meio = `partial` (retomada segura reexecutando a janela).
 * - O armazenamento pode ser em memória (demonstração) ou PostgreSQL (modo real, sync/pg-store.ts); tudo é aguardado.
 * - NADA aqui agenda execuções (sem cron): quem chama decide quando. Atualização manual tem intervalo mínimo.
 * - Só aceita `AuthorizedSyncTarget` (sync/eligibility.ts): vínculo confirmado + conexão ativa. Ativos prováveis,
 *   não encontrados, sem acesso ou com autorização expirada/revogada nunca chegam ao conector.
 */
import { civilDateInZone, syncWindow, type DateRange } from '../dates'
import { ConnectorError, RETRYABLE_KINDS, type AdsReadConnector, type ConnectorContext, type ConnectorErrorKind, type Ga4ReadConnector, type GtmReadConnector } from '../connectors/contracts'
import type { Asset } from '../model'
import type { AuthorizedSyncTarget } from './eligibility'
import type { AlertKind, SyncKind, SyncRun, SyncStore, SyncTrigger } from './store'

export const DAILY_LOOKBACK_DAYS = 7
export const REPROCESS_LOOKBACK_DAYS = 30
/** N2: intervalo DEMONSTRATIVO — aplicado sobre estado em memória, por instância do servidor (não é controle distribuído). */
export const MANUAL_MIN_INTERVAL_MS = 15 * 60_000
export const LEASE_TTL_MS = 5 * 60_000
export const MAX_ATTEMPTS = 4
export const MAX_BACKOFF_MS = 60_000
export const MAX_PAGES = 200 // proteção contra paginação infinita

export type SyncDeps = {
  store: SyncStore
  now: () => Date
  /** Espera entre tentativas (injetada: testes não dormem de verdade). */
  sleep: (ms: number) => Promise<void>
  /** Identificador desta execução para o lease (ex.: id do processo + contador). */
  owner: string
  newRunId: () => string
  baseDelayMs?: number
  maxAttempts?: number
}

class StopError extends Error {
  constructor(readonly kind: ConnectorErrorKind, message: string, readonly retryAfterSeconds: number | null) { super(message) }
}

function sanitize(message: string): string {
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, '[omitido]').slice(0, 160)
}

/** Executa `fn` com novas tentativas para erros recuperáveis. Conta tentativas em `counter`. */
async function withRetry<T>(deps: SyncDeps, counter: { attempts: number }, fn: () => Promise<T>): Promise<T> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS
  const base = deps.baseDelayMs ?? 1000
  for (let attempt = 1; ; attempt++) {
    counter.attempts++
    try {
      return await fn()
    } catch (error) {
      const e = error instanceof ConnectorError ? error : new ConnectorError('transient', error instanceof Error ? error.message : 'erro desconhecido')
      if (!RETRYABLE_KINDS.has(e.kind) || attempt >= max) throw new StopError(e.kind, sanitize(e.message), e.retryAfterSeconds)
      const wait = e.kind === 'rate_limited' && e.retryAfterSeconds !== null
        ? Math.min(e.retryAfterSeconds * 1000, MAX_BACKOFF_MS)
        : Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS)
      await deps.sleep(wait)
    }
  }
}

const ALERT_FOR: Partial<Record<ConnectorErrorKind, AlertKind>> = {
  auth_expired: 'auth_expired', auth_revoked: 'auth_revoked', permission_denied: 'permission_denied', rate_limited: 'rate_limited',
}

type RunState = { attempts: number; pages: number; inserted: number; updated: number; unchanged: number }

async function runGuarded(
  deps: SyncDeps, asset: Asset, kind: SyncKind, trigger: SyncTrigger, range: DateRange | null,
  body: (state: RunState, runId: string) => Promise<void>,
): Promise<SyncRun> {
  const startedAt = deps.now()
  const base = { id: deps.newRunId(), assetId: asset.id, kind, trigger, range, startedAt: startedAt.toISOString() }
  const state: RunState = { attempts: 0, pages: 0, inserted: 0, updated: 0, unchanged: 0 }
  if (!(await deps.store.tryAcquireLease(asset.id, deps.owner, startedAt, LEASE_TTL_MS, { runId: base.id, kind, trigger, range }))) {
    const run: SyncRun = { ...base, status: 'skipped_locked', attempts: 0, pagesDone: 0, rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 0,
      errorKind: null, errorMessage: 'outra sincronização desta conta está em andamento', nextAttemptAt: null, finishedAt: deps.now().toISOString() }
    await deps.store.recordRun(run)
    return run
  }
  try {
    await body(state, base.id)
    const run: SyncRun = { ...base, status: 'succeeded', attempts: state.attempts, pagesDone: state.pages, rowsInserted: state.inserted,
      rowsUpdated: state.updated, rowsUnchanged: state.unchanged, errorKind: null, errorMessage: null, nextAttemptAt: null, finishedAt: deps.now().toISOString() }
    await deps.store.recordRun(run)
    await deps.store.resolveAlerts(asset.id, ['auth_expired', 'auth_revoked', 'permission_denied', 'rate_limited', 'sync_failed', 'sync_partial', 'stale_data'], deps.now())
    return run
  } catch (error) {
    const stop = error instanceof StopError ? error : new StopError('transient', sanitize(error instanceof Error ? error.message : 'erro'), null)
    const partial = state.pages > 0
    const now = deps.now()
    const nextAttemptAt = RETRYABLE_KINDS.has(stop.kind)
      ? new Date(now.getTime() + (stop.retryAfterSeconds !== null ? stop.retryAfterSeconds * 1000 : 15 * 60_000)).toISOString()
      : null
    const run: SyncRun = { ...base, status: partial ? 'partial' : 'failed', attempts: state.attempts, pagesDone: state.pages,
      rowsInserted: state.inserted, rowsUpdated: state.updated, rowsUnchanged: state.unchanged, errorKind: stop.kind,
      errorMessage: stop.message, nextAttemptAt, finishedAt: now.toISOString() }
    await deps.store.recordRun(run)
    await deps.store.openAlert(asset.id, ALERT_FOR[stop.kind] ?? (partial ? 'sync_partial' : 'sync_failed'), stop.message, now)
    return run
  } finally {
    await deps.store.releaseLease(asset.id, deps.owner)
  }
}

function contextFor(asset: Asset): ConnectorContext {
  if (!asset.connectionId) throw new StopError('permission_denied', 'ativo sem conexão autorizada', null)
  return { connectionId: asset.connectionId, loginCustomerId: asset.accessPath === 'manager' ? asset.loginCustomerId : null }
}

/** Janela diária no fuso da conta (fallback: fuso de exibição informado). */
export function dailyRange(asset: Asset, now: Date, fallbackTimeZone: string, lookback = DAILY_LOOKBACK_DAYS): DateRange {
  return syncWindow(civilDateInZone(now, asset.timeZone ?? fallbackTimeZone), lookback)
}

export async function syncAdsAsset(deps: SyncDeps, connector: AdsReadConnector, asset: AuthorizedSyncTarget, range: DateRange, trigger: SyncTrigger): Promise<SyncRun> {
  return runGuarded(deps, asset, 'ads_daily', trigger, range, async (state, runId) => {
    const ctx = contextFor(asset)
    const account = await withRetry(deps, state, () => connector.getAccount(ctx, asset.externalId))
    await deps.store.observeAsset(asset.id, { currencyCode: account.currencyCode, timeZone: account.timeZone, accountStatus: account.status, observedAt: deps.now().toISOString() })
    if (account.status === 'suspended') await deps.store.openAlert(asset.id, 'account_suspended', 'conta suspensa na plataforma', deps.now())
    else await deps.store.resolveAlerts(asset.id, ['account_suspended'], deps.now())
    let token: string | null = null
    let pages = 0
    do {
      const page = await withRetry(deps, state, () => connector.listCampaigns(ctx, asset.externalId, token))
      await deps.store.upsertCampaigns(asset.id, page.items, deps.now())
      token = page.nextPageToken
      if (++pages > MAX_PAGES) throw new StopError('invalid_request', 'paginação de campanhas excedeu o limite', null)
    } while (token)
    token = null
    pages = 0
    do {
      const page = await withRetry(deps, state, () => connector.getDailyMetrics(ctx, asset.externalId, range, token))
      const res = await deps.store.upsertAdsRows(page.items.map(r => ({
        assetId: asset.id, campaignExternalId: r.campaignExternalId, day: r.date, currency: account.currencyCode,
        impressions: r.impressions, clicks: r.clicks, costMicros: r.costMicros, conversions: r.conversions,
        conversionBasis: r.conversionBasis, attribution: r.attribution, syncRunId: runId,
      })))
      state.inserted += res.inserted; state.updated += res.updated; state.unchanged += res.unchanged
      state.pages++
      token = page.nextPageToken
      if (++pages > MAX_PAGES) throw new StopError('invalid_request', 'paginação de métricas excedeu o limite', null)
    } while (token)
  })
}

export async function syncGa4Asset(deps: SyncDeps, connector: Ga4ReadConnector, asset: AuthorizedSyncTarget, range: DateRange, trigger: SyncTrigger): Promise<SyncRun> {
  return runGuarded(deps, asset, 'ga4_daily', trigger, range, async (state, runId) => {
    const ctx = contextFor(asset)
    let token: string | null = null
    let pages = 0
    do {
      const page = await withRetry(deps, state, () => connector.runDailyReport(ctx, asset.externalId, range, token))
      const res = await deps.store.upsertGa4Rows(page.items.map(r => ({ ...r, assetId: asset.id, syncRunId: runId })))
      state.inserted += res.inserted; state.updated += res.updated; state.unchanged += res.unchanged
      state.pages++
      token = page.nextPageToken
      if (++pages > MAX_PAGES) throw new StopError('invalid_request', 'paginação GA4 excedeu o limite', null)
    } while (token)
  })
}

export async function syncGtmAsset(deps: SyncDeps, connector: GtmReadConnector, asset: AuthorizedSyncTarget, trigger: SyncTrigger): Promise<SyncRun> {
  return runGuarded(deps, asset, 'gtm_snapshot', trigger, null, async (state, runId) => {
    const ctx = contextFor(asset)
    const diag = await withRetry(deps, state, () => connector.getDiagnostics(ctx, asset.externalId))
    await deps.store.saveGtm(asset.id, diag, deps.now())
    state.pages++
  })
}

/** Atualização manual: no máximo uma por ativo a cada 15 minutos (controle de custo e de cota). */
export function manualSyncAllowed(lastManualAt: string | null, now: Date, minIntervalMs = MANUAL_MIN_INTERVAL_MS): { allowed: boolean; retryAt: string | null } {
  if (!lastManualAt) return { allowed: true, retryAt: null }
  const next = Date.parse(lastManualAt) + minIntervalMs
  return Number.isFinite(next) && next > now.getTime() ? { allowed: false, retryAt: new Date(next).toISOString() } : { allowed: true, retryAt: null }
}

/** Dados desatualizados: última sincronização bem-sucedida há mais de `maxAgeHours` (padrão 36 h). */
export function isStale(lastSuccessAt: string | null, now: Date, maxAgeHours = 36): boolean {
  if (!lastSuccessAt) return true
  return now.getTime() - Date.parse(lastSuccessAt) > maxAgeHours * 3_600_000
}
