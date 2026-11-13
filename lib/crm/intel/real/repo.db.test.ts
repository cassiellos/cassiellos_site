/** Repositório do modo real — PostgreSQL LOCAL descartável (0001–0019). Dados sintéticos; Financeiro só lido. */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import type { AdAccountInfo } from '../connectors/contracts'
import { parseKeyRing, PgCredentialVault } from '../vault/pg-vault'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables, testKey } from '../vault/test-db'
import * as repo from './repo'

const acct = (id: string, name: string, platform: 'google_ads' | 'meta_ads' = 'google_ads', parent: string | null = null): AdAccountInfo =>
  ({ platform, externalId: id, name, currencyCode: platform === 'meta_ads' ? 'USD' : 'BRL', timeZone: 'America/Sao_Paulo', status: 'active', parentExternalId: parent })

describe('repositório do modo real (banco descartável)', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  let vault: PgCredentialVault
  before(async () => { pool = await openLocalPool(); vault = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(3) })) })
  beforeEach(async () => { await resetIntelTables(pool); await pool.query(`DELETE FROM crm.finance_clients WHERE name LIKE 'Fin Teste%'`) })
  after(async () => { await pool?.end() })

  async function connection(provider: 'google' | 'meta' = 'google') {
    const meta = await vault.store({ connectionId: 'n', provider, secret: 'segredo-' + provider, scopes: [], expiresAt: null })
    return repo.createConnection(pool, 'admin1', { provider, authKind: 'oauth_user', label: 'Conexão ' + provider, credentialRef: meta.ref, scopes: provider === 'google' ? ['adwords'] : ['ads_read'], principalHint: null, expiresAt: null })
  }

  it('cadastro, edição, pausa e arquivamento de cliente; nome validado; agência única', async () => {
    const c = await repo.createClient(pool, 'admin1', { name: '  Clínica   Sorriso ', notes: 'contrato mensal' })
    assert.equal(c.name, 'Clínica Sorriso'); assert.equal(c.status, 'active'); assert.equal(c.kind, 'client')
    await assert.rejects(repo.createClient(pool, 'admin1', { name: 'x' }), (e: unknown) => e instanceof repo.RepoError && e.code === 'INVALID')
    await assert.rejects(repo.createClient(pool, 'admin1', { name: '<script>' }), repo.RepoError)
    const u = await repo.updateClient(pool, 'admin1', c.id, { name: 'Clínica Sorriso Ltda', status: 'paused' })
    assert.equal(u.status, 'paused')
    await assert.rejects(repo.updateClient(pool, 'admin1', c.id, { status: 'archived' }), repo.RepoError)
    const ag1 = await repo.ensureAgencyClient(pool, 'admin1'); const ag2 = await repo.ensureAgencyClient(pool, 'admin1')
    assert.equal(ag1.id, ag2.id); assert.equal(ag1.kind, 'agency')
    await assert.rejects(repo.archiveClient(pool, 'admin1', ag1.id), repo.RepoError)
    await repo.archiveClient(pool, 'admin1', c.id)
    assert.equal((await repo.listClients(pool)).some(x => x.id === c.id), false)
    assert.equal((await repo.listClients(pool, { includeArchived: true })).find(x => x.id === c.id)?.status, 'archived')
    await assert.rejects(repo.updateClient(pool, 'admin1', c.id, { name: 'Outro' }), (e: unknown) => e instanceof repo.RepoError && e.code === 'ARCHIVED')
    const actions = (await repo.recentAudit(pool)).map(a => a.action)
    for (const a of ['client_created', 'client_updated', 'client_archived']) assert.ok(actions.includes(a), a)
  })

  it('vínculo financeiro explícito, opcional e único; Financeiro não é alterado', async () => {
    const fin = String((await pool.query(`INSERT INTO crm.finance_clients (name) VALUES ('Fin Teste A') RETURNING id`)).rows[0].id)
    const before = (await pool.query(`SELECT * FROM crm.finance_clients WHERE id = $1`, [fin])).rows[0]
    assert.equal((await repo.listClients(pool)).length, 0, 'cliente financeiro não vira monitorado sozinho')
    const c = await repo.createClient(pool, 'admin1', { name: 'Cliente A', financeClientId: fin })
    assert.equal(c.financeClientName, 'Fin Teste A')
    await assert.rejects(repo.createClient(pool, 'admin1', { name: 'Cliente B', financeClientId: fin }), (e: unknown) => e instanceof repo.RepoError && e.code === 'FINANCE_ALREADY_LINKED')
    await assert.rejects(repo.createClient(pool, 'admin1', { name: 'Cliente C', financeClientId: '00000000-0000-0000-0000-000000000000' }), (e: unknown) => e instanceof repo.RepoError && e.code === 'NOT_FOUND')
    assert.equal((await repo.listFinanceClients(pool)).find(f => f.id === fin)?.linkedTo, c.id)
    await repo.updateClient(pool, 'admin1', c.id, { financeClientId: null })
    assert.equal((await repo.getClient(pool, c.id))?.financeClientId, null)
    assert.deepEqual((await pool.query(`SELECT * FROM crm.finance_clients WHERE id = $1`, [fin])).rows[0], before)
  })

  it('descoberta registra contas e caminho (MCC → manager + login-customer-id) sem vincular a cliente', async () => {
    const g = await connection('google')
    await repo.upsertDiscoveredAccounts(pool, 'admin1', g.id, [acct('1111111111', 'Conta Direta'), acct('2222222222', 'Conta via MCC', 'google_ads', '9999999999')])
    const assets = await repo.listAssets(pool)
    assert.equal(assets.length, 2)
    const mcc = assets.find(a => a.externalId === '2222222222')!
    assert.deepEqual([mcc.accessPath, mcc.loginCustomerId], ['manager', '9999999999'])
    assert.equal(assets.find(a => a.externalId === '1111111111')!.accessPath, 'direct')
    assert.equal((await repo.listAssociations(pool)).length, 0, 'nenhum vínculo automático')
    await repo.upsertDiscoveredAccounts(pool, 'admin1', g.id, [acct('1111111111', 'Conta Direta (renomeada)')])
    assert.equal((await repo.listAssets(pool)).length, 2, 'redescoberta não duplica')
  })

  it('associação: proposta → confirmação explícita; dono único; compartilhamento só com justificativa; encerramento preserva histórico', async () => {
    const g = await connection('google')
    await repo.upsertDiscoveredAccounts(pool, 'admin1', g.id, [acct('3333333333', 'Conta X')])
    const asset = (await repo.listAssets(pool))[0]
    const a = await repo.createClient(pool, 'admin1', { name: 'Cliente A' })
    const b = await repo.createClient(pool, 'admin1', { name: 'Cliente B' })
    const p = await repo.proposeAssociation(pool, 'admin1', a.id, asset.id)
    assert.equal(p.status, 'probable')
    const ok = await repo.confirmAssociation(pool, 'admin1', a.id, asset.id)
    assert.equal(ok.status, 'confirmed'); assert.equal(ok.validatedBy, 'admin1'); assert.ok(ok.validatedAt)
    await assert.rejects(repo.confirmAssociation(pool, 'admin1', b.id, asset.id), (e: unknown) => e instanceof repo.RepoError && e.code === 'ASSET_ALREADY_OWNED')
    await assert.rejects(repo.confirmAssociation(pool, 'admin1', b.id, asset.id, 'curta'), (e: unknown) => e instanceof repo.RepoError && e.code === 'INVALID')
    const shared = await repo.confirmAssociation(pool, 'admin1', b.id, asset.id, 'conta compartilhada por contrato entre as duas marcas do grupo')
    assert.equal(shared.status, 'confirmed')
    await repo.endAssociation(pool, 'admin1', a.id, asset.id)
    const all = await repo.listAssociations(pool, { includeEnded: true })
    assert.equal(all.filter(x => x.status === 'ended').length, 1, 'histórico preservado')
    await repo.confirmAssociation(pool, 'admin1', a.id, asset.id, 'reativação compartilhada justificada para teste')
    assert.equal((await repo.listAssociations(pool, { clientId: a.id })).length, 1)
  })

  it('confirmação exige conta com acesso vigente; revogação apaga a credencial e encerra o acesso', async () => {
    const g = await connection('google')
    await repo.upsertDiscoveredAccounts(pool, 'admin1', g.id, [acct('4444444444', 'Conta Y')])
    const asset = (await repo.listAssets(pool))[0]
    const c = await repo.createClient(pool, 'admin1', { name: 'Cliente Y' })
    await repo.revokeConnection(pool, vault, 'admin1', g.id)
    assert.equal((await repo.getConnection(pool, g.id))?.status, 'revoked')
    assert.equal((await repo.getAsset(pool, asset.id))?.connectionId, null)
    await assert.rejects(repo.confirmAssociation(pool, 'admin1', c.id, asset.id), (e: unknown) => e instanceof repo.RepoError && e.code === 'INVALID')
    assert.equal(Number((await pool.query(`SELECT octet_length(ciphertext) n FROM crm.mi_credentials`)).rows[0].n), 1)
  })

  it('auditoria nunca grava segredo', async () => {
    await assert.rejects(repo.audit(pool, 'admin1', 'client_created', 'client', 'x', { accessToken: 'abc' }), /chave proibida/)
    assert.ok(!JSON.stringify(await repo.recentAudit(pool)).match(/segredo-/))
  })
})
