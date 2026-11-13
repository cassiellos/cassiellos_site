/**
 * Central de Inteligência — REPOSITÓRIO DO MODO REAL (clientes monitorados, conexões, contas e vínculos), sobre as
 * tabelas mi_* das migrações 0017/0018. Toda alteração deixa trilha em crm.mi_audit_log (quem, o quê, quando).
 *
 * Regras:
 * - Cliente financeiro NÃO vira cliente monitorado sozinho: o vínculo a crm.finance_clients é explícito, opcional e único,
 *   e o Financeiro é só lido (nome), nunca alterado.
 * - Conta descoberta numa conexão NÃO alimenta relatório até o titular CONFIRMAR o vínculo cliente × conta. Nada é
 *   associado por semelhança de nome; a proposta (`probable`) também é sempre explícita.
 * - Uma conta só pode ter UM dono confirmado (índice mi_client_assets_one_owner), salvo compartilhamento com justificativa.
 * - Encerrar um vínculo preserva o histórico (status `ended`, `valid_to`); arquivar um cliente encerra seus vínculos.
 */
import type { AdAccountInfo } from '../connectors/contracts'
import { assertNoSecretsInPayload, type CredentialRef, type CredentialVault } from '../credential-vault'
import type { AccessPath, AssociationStatus, ClientKind, ClientStatus, ConnectionProvider, ConnectionStatus } from '../model'
import type { Queryable } from '../vault/pg-vault'

export class RepoError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'ASSET_ALREADY_OWNED' | 'FINANCE_ALREADY_LINKED' | 'ARCHIVED', message: string = code) { super(message); this.name = 'RepoError' }
}

export type ClientRow = { id: string; name: string; kind: ClientKind; status: ClientStatus; financeClientId: string | null; financeClientName: string | null; notes: string; reportTimeZone: string; createdAt: string; updatedAt: string }
export type ConnectionRow = { id: string; provider: ConnectionProvider; authKind: 'oauth_user' | 'system_user'; label: string; status: ConnectionStatus; scopes: string[]; principalHint: string | null; expiresAt: string | null; lastVerifiedAt: string | null; lastErrorCode: string | null; createdAt: string }
export type AssetRow = { id: string; platform: 'google_ads' | 'meta_ads' | 'ga4' | 'gtm'; externalId: string; name: string; currencyCode: string | null; timeZone: string | null; accountStatus: string; lastSeenAt: string | null; connectionId: string | null; accessPath: AccessPath | null; loginCustomerId: string | null }
export type AssociationRow = { id: string; clientId: string; assetId: string; status: AssociationStatus; note: string; sharedJustification: string | null; validatedBy: string | null; validatedAt: string | null; validFrom: string; validTo: string | null }

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'()\-/]{1,158}$/u
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const pgCode = (e: unknown) => (e as { code?: string }).code
const pgConstraint = (e: unknown) => (e as { constraint?: string }).constraint

export async function audit(db: Queryable, actor: string, action: string, entity: 'client' | 'connection' | 'asset' | 'asset_access' | 'client_asset' | 'sync_job', entityId: string, details: Record<string, unknown> = {}) {
  assertNoSecretsInPayload(details)
  await db.query(`INSERT INTO crm.mi_audit_log (actor, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actor.slice(0, 80) || 'desconhecido', action, entity, entityId, JSON.stringify(details)])
}

/* ------------------------------------------------------------------ clientes ------------------------------------------------------------------ */

const CLIENT_SELECT = `SELECT c.id, c.name, c.kind, c.status, c.finance_client_id, f.name AS finance_name, c.notes, c.report_timezone, c.created_at, c.updated_at
  FROM crm.mi_clients c LEFT JOIN crm.finance_clients f ON f.id = c.finance_client_id`
const toClient = (r: Record<string, unknown>): ClientRow => ({ id: String(r.id), name: String(r.name), kind: r.kind as ClientKind, status: r.status as ClientStatus,
  financeClientId: (r.finance_client_id as string) ?? null, financeClientName: (r.finance_name as string) ?? null, notes: String(r.notes ?? ''),
  reportTimeZone: String(r.report_timezone), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! })

export async function listClients(db: Queryable, opts: { includeArchived?: boolean } = {}): Promise<ClientRow[]> {
  const { rows } = await db.query(CLIENT_SELECT + (opts.includeArchived ? '' : ` WHERE c.status <> 'archived'`) + ` ORDER BY c.kind, lower(c.name)`)
  return rows.map(toClient)
}

export async function getClient(db: Queryable, id: string): Promise<ClientRow | null> {
  if (!isUuid(id)) return null
  const { rows } = await db.query(CLIENT_SELECT + ` WHERE c.id = $1`, [id])
  return rows[0] ? toClient(rows[0]) : null
}

function validName(name: unknown): string {
  if (typeof name !== 'string') throw new RepoError('INVALID', 'nome')
  const n = name.trim().replace(/\s+/g, ' ')
  if (!NAME_RE.test(n)) throw new RepoError('INVALID', 'nome')
  return n
}
function validNotes(notes: unknown): string {
  if (notes === undefined || notes === null) return ''
  if (typeof notes !== 'string' || notes.length > 2000) throw new RepoError('INVALID', 'observações')
  return notes.trim()
}

async function assertFinanceClient(db: Queryable, id: string | null) {
  if (id === null) return
  if (!isUuid(id)) throw new RepoError('INVALID', 'cliente financeiro')
  const { rows } = await db.query(`SELECT 1 FROM crm.finance_clients WHERE id = $1`, [id])
  if (!rows[0]) throw new RepoError('NOT_FOUND', 'cliente financeiro')
}

/** Lista o cadastro financeiro (SOMENTE LEITURA: id e nome) para associação explícita. */
export async function listFinanceClients(db: Queryable): Promise<{ id: string; name: string; linkedTo: string | null }[]> {
  const { rows } = await db.query(`SELECT f.id, f.name, c.id AS linked FROM crm.finance_clients f LEFT JOIN crm.mi_clients c ON c.finance_client_id = f.id
    WHERE f.archived_at IS NULL ORDER BY lower(f.name) LIMIT 500`)
  return rows.map(r => ({ id: String(r.id), name: String(r.name), linkedTo: (r.linked as string) ?? null }))
}

export async function createClient(db: Queryable, actor: string, input: { name: unknown; notes?: unknown; financeClientId?: unknown; kind?: ClientKind }): Promise<ClientRow> {
  const name = validName(input.name)
  const notes = validNotes(input.notes)
  const fin = input.financeClientId === undefined || input.financeClientId === null || input.financeClientId === '' ? null : String(input.financeClientId)
  await assertFinanceClient(db, fin)
  try {
    const { rows } = await db.query(`INSERT INTO crm.mi_clients (name, kind, notes, finance_client_id) VALUES ($1, $2, $3, $4) RETURNING id`, [name, input.kind ?? 'client', notes, fin])
    const id = String(rows[0].id)
    await audit(db, actor, 'client_created', 'client', id, { kind: input.kind ?? 'client', financeLinked: fin !== null })
    return (await getClient(db, id))!
  } catch (e) {
    if (pgCode(e) === '23505' && pgConstraint(e) === 'mi_clients_finance_unique') throw new RepoError('FINANCE_ALREADY_LINKED')
    if (pgCode(e) === '23505') throw new RepoError('CONFLICT', 'já existe a agência')
    throw e
  }
}

/** A Cassiellos como cliente interno `agency` (área Prospecção). Cria uma única vez. */
export async function ensureAgencyClient(db: Queryable, actor: string): Promise<ClientRow> {
  const { rows } = await db.query(`SELECT id FROM crm.mi_clients WHERE kind = 'agency' AND archived_at IS NULL LIMIT 1`)
  if (rows[0]) return (await getClient(db, String(rows[0].id)))!
  try { return await createClient(db, actor, { name: 'Cassiellos', kind: 'agency' }) } catch (e) {
    if (e instanceof RepoError && e.code === 'CONFLICT') { const again = await db.query(`SELECT id FROM crm.mi_clients WHERE kind = 'agency' AND archived_at IS NULL LIMIT 1`); return (await getClient(db, String(again.rows[0].id)))! }
    throw e
  }
}

export async function updateClient(db: Queryable, actor: string, id: string, patch: { name?: unknown; notes?: unknown; status?: unknown; financeClientId?: unknown }): Promise<ClientRow> {
  const cur = await getClient(db, id)
  if (!cur) throw new RepoError('NOT_FOUND')
  if (cur.status === 'archived') throw new RepoError('ARCHIVED')
  const name = patch.name === undefined ? cur.name : validName(patch.name)
  const notes = patch.notes === undefined ? cur.notes : validNotes(patch.notes)
  let status = cur.status
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'paused') throw new RepoError('INVALID', 'situação')
    if (cur.kind === 'agency' && patch.status !== 'active') throw new RepoError('INVALID', 'a agência permanece ativa')
    status = patch.status
  }
  let fin = cur.financeClientId
  if (patch.financeClientId !== undefined) {
    fin = patch.financeClientId === null || patch.financeClientId === '' ? null : String(patch.financeClientId)
    await assertFinanceClient(db, fin)
  }
  try {
    await db.query(`UPDATE crm.mi_clients SET name = $2, notes = $3, status = $4, finance_client_id = $5, updated_at = now() WHERE id = $1`, [id, name, notes, status, fin])
  } catch (e) {
    if (pgCode(e) === '23505') throw new RepoError('FINANCE_ALREADY_LINKED')
    throw e
  }
  const changed = [name !== cur.name && 'name', notes !== cur.notes && 'notes', status !== cur.status && 'status', fin !== cur.financeClientId && 'finance_link'].filter(Boolean)
  if (changed.length) await audit(db, actor, 'client_updated', 'client', id, { changed, status })
  return (await getClient(db, id))!
}

/** Arquiva o cliente e ENCERRA seus vínculos (histórico preservado; métricas antigas continuam no banco). */
export async function archiveClient(db: Queryable, actor: string, id: string): Promise<void> {
  const cur = await getClient(db, id)
  if (!cur) throw new RepoError('NOT_FOUND')
  if (cur.kind === 'agency') throw new RepoError('INVALID', 'a agência não é arquivada')
  if (cur.status === 'archived') return
  const ended = await db.query(`UPDATE crm.mi_client_assets SET status = 'ended', valid_to = now() WHERE client_id = $1 AND status <> 'ended' RETURNING asset_id`, [id])
  await db.query(`UPDATE crm.mi_clients SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`, [id])
  await audit(db, actor, 'client_archived', 'client', id, { endedAssociations: ended.rows.length })
}

/* ------------------------------------------------------------------ conexões ------------------------------------------------------------------ */

const toConnection = (r: Record<string, unknown>): ConnectionRow => ({ id: String(r.id), provider: r.provider as ConnectionProvider, authKind: r.auth_kind as ConnectionRow['authKind'],
  label: String(r.label), status: r.status as ConnectionStatus, scopes: (r.scopes as string[]) ?? [], principalHint: (r.principal_hint as string) ?? null,
  expiresAt: iso(r.expires_at), lastVerifiedAt: iso(r.last_verified_at), lastErrorCode: (r.last_error_code as string) ?? null, createdAt: iso(r.created_at)! })

export async function listConnections(db: Queryable): Promise<ConnectionRow[]> {
  const { rows } = await db.query(`SELECT * FROM crm.mi_connections ORDER BY created_at DESC`)
  return rows.map(toConnection)
}

export async function getConnection(db: Queryable, id: string): Promise<(ConnectionRow & { credentialRef: CredentialRef | null }) | null> {
  if (!isUuid(id)) return null
  const { rows } = await db.query(`SELECT * FROM crm.mi_connections WHERE id = $1`, [id])
  return rows[0] ? { ...toConnection(rows[0]), credentialRef: (rows[0].credential_ref as CredentialRef) ?? null } : null
}

export async function createConnection(db: Queryable, actor: string, input: { provider: ConnectionProvider; authKind: 'oauth_user' | 'system_user'; label: string; credentialRef: CredentialRef; scopes: readonly string[]; principalHint: string | null; expiresAt: string | null }): Promise<ConnectionRow> {
  const { rows } = await db.query(`INSERT INTO crm.mi_connections (provider, auth_kind, label, status, scopes, credential_ref, principal_hint, expires_at, last_verified_at)
    VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, now()) RETURNING *`,
    [input.provider, input.authKind, input.label.slice(0, 120), [...input.scopes].slice(0, 20), input.credentialRef, input.principalHint?.slice(0, 120) ?? null, input.expiresAt])
  const c = toConnection(rows[0])
  await audit(db, actor, 'connection_authorized', 'connection', c.id, { provider: c.provider, scopes: c.scopes })
  return c
}

export async function markConnection(db: Queryable, id: string, status: Exclude<ConnectionStatus, 'revoked' | 'pending'>, errorCode: string | null): Promise<void> {
  await db.query(`UPDATE crm.mi_connections SET status = $2, last_error_code = $3, last_verified_at = CASE WHEN $2 = 'active' THEN now() ELSE last_verified_at END, updated_at = now()
    WHERE id = $1 AND status <> 'revoked'`, [id, status, errorCode])
}

/** Revoga a conexão: apaga a credencial do cofre, encerra os caminhos de acesso e deixa trilha. Vínculos ficam (histórico). */
export async function revokeConnection(db: Queryable, vault: CredentialVault, actor: string, id: string): Promise<void> {
  const conn = await getConnection(db, id)
  if (!conn) throw new RepoError('NOT_FOUND')
  if (conn.status === 'revoked') return
  if (conn.credentialRef) await vault.revoke(conn.credentialRef)
  await db.query(`UPDATE crm.mi_connections SET status = 'revoked', revoked_at = now(), updated_at = now() WHERE id = $1`, [id])
  await db.query(`UPDATE crm.mi_asset_access SET revoked_at = now() WHERE connection_id = $1 AND revoked_at IS NULL`, [id])
  await audit(db, actor, 'connection_revoked', 'connection', id, { provider: conn.provider })
}

/* --------------------------------------------------------------- contas descobertas --------------------------------------------------------------- */

/**
 * Registra as contas que a conexão consegue ler (sem vincular a cliente nenhum). Google Ads via MCC usa caminho
 * `manager` com login-customer-id; acesso direto usa `direct`.
 */
export async function upsertDiscoveredAccounts(db: Queryable, actor: string, connectionId: string, accounts: readonly AdAccountInfo[]): Promise<number> {
  let n = 0
  for (const a of accounts) {
    const { rows } = await db.query(`INSERT INTO crm.mi_assets (platform, external_id, name, currency_code, time_zone, account_status, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (platform, external_context, external_id) DO UPDATE SET name = EXCLUDED.name, currency_code = EXCLUDED.currency_code,
        time_zone = EXCLUDED.time_zone, account_status = EXCLUDED.account_status, last_seen_at = now() RETURNING id`,
      [a.platform, a.externalId, a.name.slice(0, 200) || a.externalId, /^[A-Z]{3}$/.test(a.currencyCode) ? a.currencyCode : null,
        /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(a.timeZone) ? a.timeZone : null, a.status])
    const assetId = String(rows[0].id)
    const manager = a.platform === 'google_ads' && a.parentExternalId && a.parentExternalId !== a.externalId
    await db.query(`INSERT INTO crm.mi_asset_access (asset_id, connection_id, access_path, login_customer_id, verified_at) VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (asset_id, connection_id, access_path) DO UPDATE SET verified_at = now(), revoked_at = NULL, login_customer_id = EXCLUDED.login_customer_id`,
      [assetId, connectionId, manager ? 'manager' : 'direct', manager ? a.parentExternalId : null])
    n++
  }
  await audit(db, actor, 'accounts_discovered', 'connection', connectionId, { count: n })
  return n
}

const ASSET_SELECT = `SELECT a.id, a.platform, a.external_id, a.name, a.currency_code, a.time_zone, a.account_status, a.last_seen_at,
    acc.connection_id, acc.access_path, acc.login_customer_id
  FROM crm.mi_assets a
  LEFT JOIN LATERAL (SELECT x.connection_id, x.access_path, x.login_customer_id FROM crm.mi_asset_access x JOIN crm.mi_connections c ON c.id = x.connection_id
     WHERE x.asset_id = a.id AND x.revoked_at IS NULL AND c.status <> 'revoked' ORDER BY (c.status = 'active') DESC, x.verified_at DESC NULLS LAST LIMIT 1) acc ON true`
const toAsset = (r: Record<string, unknown>): AssetRow => ({ id: String(r.id), platform: r.platform as AssetRow['platform'], externalId: String(r.external_id), name: String(r.name),
  currencyCode: (r.currency_code as string) ?? null, timeZone: (r.time_zone as string) ?? null, accountStatus: String(r.account_status), lastSeenAt: iso(r.last_seen_at),
  connectionId: (r.connection_id as string) ?? null, accessPath: (r.access_path as AccessPath) ?? null, loginCustomerId: (r.login_customer_id as string) ?? null })

export async function listAssets(db: Queryable): Promise<AssetRow[]> {
  const { rows } = await db.query(ASSET_SELECT + ` WHERE a.platform IN ('google_ads', 'meta_ads') ORDER BY a.platform, lower(a.name)`)
  return rows.map(toAsset)
}

export async function getAsset(db: Queryable, id: string): Promise<AssetRow | null> {
  if (!isUuid(id)) return null
  const { rows } = await db.query(ASSET_SELECT + ` WHERE a.id = $1`, [id])
  return rows[0] ? toAsset(rows[0]) : null
}

/* ------------------------------------------------------------------ vínculos ------------------------------------------------------------------ */

const toAssociation = (r: Record<string, unknown>): AssociationRow => ({ id: String(r.id), clientId: String(r.client_id), assetId: String(r.asset_id), status: r.status as AssociationStatus,
  note: String(r.note ?? ''), sharedJustification: (r.shared_justification as string) ?? null, validatedBy: (r.validated_by as string) ?? null,
  validatedAt: iso(r.validated_at), validFrom: iso(r.valid_from)!, validTo: iso(r.valid_to) })

export async function listAssociations(db: Queryable, opts: { clientId?: string; includeEnded?: boolean } = {}): Promise<AssociationRow[]> {
  const where: string[] = []; const params: unknown[] = []
  if (opts.clientId) { params.push(opts.clientId); where.push(`client_id = $${params.length}`) }
  if (!opts.includeEnded) where.push(`status <> 'ended'`)
  const { rows } = await db.query(`SELECT * FROM crm.mi_client_assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`, params)
  return rows.map(toAssociation)
}

async function activeClient(db: Queryable, clientId: string): Promise<ClientRow> {
  const c = await getClient(db, clientId)
  if (!c) throw new RepoError('NOT_FOUND', 'cliente')
  if (c.status === 'archived') throw new RepoError('ARCHIVED')
  return c
}

/** Proposta explícita (aguardando confirmação). Nunca alimenta relatório. */
export async function proposeAssociation(db: Queryable, actor: string, clientId: string, assetId: string, note = ''): Promise<AssociationRow> {
  await activeClient(db, clientId)
  if (!(await getAsset(db, assetId))) throw new RepoError('NOT_FOUND', 'conta')
  try {
    const { rows } = await db.query(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status, note) VALUES ($1, $2, 'probable', $3) RETURNING *`, [clientId, assetId, note.slice(0, 500)])
    await audit(db, actor, 'association_proposed', 'client_asset', String(rows[0].id), { clientId, assetId })
    return toAssociation(rows[0])
  } catch (e) {
    if (pgCode(e) === '23505') throw new RepoError('CONFLICT', 'vínculo já existe')
    throw e
  }
}

/**
 * Confirmação EXPLÍCITA (só ela libera a conta para os relatórios do cliente). Exige conta com acesso vigente.
 * Conta já confirmada para outro cliente → ASSET_ALREADY_OWNED, salvo `sharedJustification` (10–500 caracteres).
 */
export async function confirmAssociation(db: Queryable, actor: string, clientId: string, assetId: string, sharedJustification: string | null = null): Promise<AssociationRow> {
  await activeClient(db, clientId)
  const asset = await getAsset(db, assetId)
  if (!asset) throw new RepoError('NOT_FOUND', 'conta')
  if (!asset.connectionId) throw new RepoError('INVALID', 'conta sem acesso autorizado')
  const just = sharedJustification?.trim() || null
  if (just !== null && (just.length < 10 || just.length > 500)) throw new RepoError('INVALID', 'justificativa')
  try {
    const { rows } = await db.query(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status, shared_justification, validated_by, validated_at)
      VALUES ($1, $2, 'confirmed', $3, $4, now())
      ON CONFLICT (client_id, asset_id) WHERE status <> 'ended'
      DO UPDATE SET status = 'confirmed', shared_justification = EXCLUDED.shared_justification, validated_by = EXCLUDED.validated_by, validated_at = now()
      RETURNING *`, [clientId, assetId, just, actor.slice(0, 80)])
    await audit(db, actor, 'association_confirmed', 'client_asset', String(rows[0].id), { clientId, assetId, shared: just !== null })
    return toAssociation(rows[0])
  } catch (e) {
    if (pgCode(e) === '23505' && pgConstraint(e) === 'mi_client_assets_one_owner') throw new RepoError('ASSET_ALREADY_OWNED')
    throw e
  }
}

/** Encerra o vínculo (histórico preservado). A conta deixa de alimentar os relatórios do cliente a partir de agora. */
export async function endAssociation(db: Queryable, actor: string, clientId: string, assetId: string): Promise<void> {
  if (!isUuid(clientId) || !isUuid(assetId)) throw new RepoError('INVALID')
  const { rows } = await db.query(`UPDATE crm.mi_client_assets SET status = 'ended', valid_to = now() WHERE client_id = $1 AND asset_id = $2 AND status <> 'ended' RETURNING id`, [clientId, assetId])
  if (!rows[0]) throw new RepoError('NOT_FOUND', 'vínculo')
  await audit(db, actor, 'association_ended', 'client_asset', String(rows[0].id), { clientId, assetId })
}

export async function recentAudit(db: Queryable, limit = 40): Promise<{ at: string; actor: string; action: string; entity: string; entityId: string; details: Record<string, unknown> }[]> {
  const { rows } = await db.query(`SELECT created_at, actor, action, entity, entity_id, details FROM crm.mi_audit_log ORDER BY id DESC LIMIT $1`, [Math.min(limit, 200)])
  return rows.map(r => ({ at: iso(r.created_at)!, actor: String(r.actor), action: String(r.action), entity: String(r.entity), entityId: String(r.entity_id), details: r.details as Record<string, unknown> }))
}
