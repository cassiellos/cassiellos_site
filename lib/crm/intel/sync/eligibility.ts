/**
 * Central de Inteligência — AUTORIZAÇÃO DE SINCRONIZAÇÃO (regra explícita, aplicada na SELEÇÃO dos ativos).
 *
 * Um ativo só pode ser consultado numa plataforma quando TODAS as condições valem:
 * 1. vínculo CONFIRMADO com pelo menos um cliente (provável, não encontrado, sem acesso, pendente ou encerrado → não);
 * 2. conexão técnica existente e ATIVA (expirada, revogada, pendente ou com erro → não);
 * 3. caminho de acesso conhecido (direto ou conta gerente);
 * 4. na atualização MANUAL, a conta também não pode estar suspensa.
 *
 * O motor de sincronização (engine.ts) só aceita `AuthorizedSyncTarget`, um tipo que SÓ esta função produz: carga
 * histórica, execução diária, atualização manual e reprocessamento passam obrigatoriamente por aqui. Não basta esconder
 * os dados depois — o ativo não autorizado nem chega ao conector.
 */
import type { ExternalAccountStatus } from '../connectors/contracts'
import type { Asset, ClientAsset, Connection } from '../model'

export type SyncPurpose = 'backfill' | 'schedule' | 'manual' | 'reprocess'

export type SyncBlockReason =
  | 'not_confirmed'        // vínculo provável/não encontrado/sem acesso/pendente: não autorizado pelo titular
  | 'no_connection'        // nenhuma conexão técnica associada
  | 'connection_expired'
  | 'connection_revoked'
  | 'connection_inactive'  // pendente ou com erro
  | 'no_access_path'       // conexão sem caminho de leitura conhecido para este ativo
  | 'account_suspended'    // somente para atualização manual

declare const authorizedBrand: unique symbol
/** Ativo autorizado para sincronizar (só `authorizeSync` cria este tipo). */
export type AuthorizedSyncTarget = Asset & { readonly [authorizedBrand]: true; readonly purpose: SyncPurpose }

export type SyncDecision = { eligible: true; target: AuthorizedSyncTarget } | { eligible: false; reason: SyncBlockReason }

export const SYNC_BLOCK_LABEL: Record<SyncBlockReason, string> = {
  not_confirmed: 'Vínculo não confirmado pelo titular — não sincronizado',
  no_connection: 'Sem conexão técnica',
  connection_expired: 'Autorização expirada — sincronização suspensa',
  connection_revoked: 'Autorização revogada — sincronização suspensa',
  connection_inactive: 'Conexão pendente ou com erro',
  no_access_path: 'Sem caminho de acesso à conta',
  account_suspended: 'Conta suspensa na plataforma — atualização manual indisponível',
}

export function hasConfirmedLink(assetId: string, links: readonly ClientAsset[]): boolean {
  return links.some(l => l.assetId === assetId && l.status === 'confirmed')
}

export function authorizeSync(
  asset: Asset, links: readonly ClientAsset[], connections: readonly Connection[], purpose: SyncPurpose,
  observedAccountStatus?: ExternalAccountStatus,
): SyncDecision {
  if (!hasConfirmedLink(asset.id, links)) return { eligible: false, reason: 'not_confirmed' }
  const conn = asset.connectionId ? connections.find(c => c.id === asset.connectionId) : undefined
  if (!conn) return { eligible: false, reason: 'no_connection' }
  if (conn.status === 'expired') return { eligible: false, reason: 'connection_expired' }
  if (conn.status === 'revoked') return { eligible: false, reason: 'connection_revoked' }
  if (conn.status !== 'active') return { eligible: false, reason: 'connection_inactive' }
  if (!asset.accessPath) return { eligible: false, reason: 'no_access_path' }
  if (purpose === 'manual' && (observedAccountStatus ?? asset.accountStatus) === 'suspended') return { eligible: false, reason: 'account_suspended' }
  return { eligible: true, target: { ...asset, purpose } as AuthorizedSyncTarget }
}

/** Seleção em lote (execução diária, carga histórica, reprocessamento): devolve autorizados e bloqueados. */
export function selectSyncTargets(
  assets: readonly Asset[], links: readonly ClientAsset[], connections: readonly Connection[], purpose: SyncPurpose,
): { targets: AuthorizedSyncTarget[]; blocked: { assetId: string; reason: SyncBlockReason }[] } {
  const targets: AuthorizedSyncTarget[] = []
  const blocked: { assetId: string; reason: SyncBlockReason }[] = []
  for (const a of assets) {
    const d = authorizeSync(a, links, connections, purpose)
    if (d.eligible) targets.push(d.target)
    else blocked.push({ assetId: a.id, reason: d.reason })
  }
  return { targets, blocked }
}
