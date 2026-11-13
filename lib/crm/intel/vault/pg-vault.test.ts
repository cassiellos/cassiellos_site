import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import type { CredentialRef } from '../credential-vault'
import { open, parseKeyRing, PgCredentialVault, seal, VaultConfigError } from './pg-vault'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables, testKey } from './test-db'

describe('cofre — chaveiro e criptografia', () => {
  it('exige MI_VAULT_KEYS válido; erros sem valores', () => {
    assert.throws(() => parseKeyRing({}), (e: unknown) => e instanceof VaultConfigError && e.reason === 'MISSING')
    assert.throws(() => parseKeyRing({ MI_VAULT_KEYS: '1:curta' }), (e: unknown) => e instanceof VaultConfigError && e.reason === 'INVALID' && !e.message.includes('curta'))
    assert.throws(() => parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) + ',1:' + testKey(2) }), VaultConfigError)
    assert.throws(() => parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1), MI_VAULT_KEY_CURRENT: '2' }), VaultConfigError)
    const ring = parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) + ',2:' + testKey(2) })
    assert.equal(ring.current, 2, 'padrão: maior versão')
  })
  it('recusa chave igual à do Google Calendar', () => {
    assert.throws(() => parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(7), CRM_GOOGLE_ENCRYPTION_KEY: testKey(7) }),
      (e: unknown) => e instanceof VaultConfigError && e.reason === 'SHARED_WITH_CALENDAR')
    assert.throws(() => parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(7), CRM_GOOGLE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('hex') }), VaultConfigError)
    assert.doesNotThrow(() => parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(7), CRM_GOOGLE_ENCRYPTION_KEY: testKey(8) }))
  })
  it('AES-256-GCM: abre o que selou; AAD amarra referência e plataforma; IV muda a cada vez', () => {
    const ring = parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) })
    const a = seal(ring, 'vault:mi-google:AAAAAAAAAAAAAAAAAAAA', 'google', 'refresh-ficticio')
    const b = seal(ring, 'vault:mi-google:AAAAAAAAAAAAAAAAAAAA', 'google', 'refresh-ficticio')
    assert.notDeepEqual(a.iv, b.iv)
    assert.ok(!a.ciphertext.toString('utf8').includes('refresh-ficticio'))
    const row = { ref: 'vault:mi-google:AAAAAAAAAAAAAAAAAAAA', provider: 'google', ...a }
    assert.equal(open(ring, row), 'refresh-ficticio')
    assert.throws(() => open(ring, { ...row, ref: 'vault:mi-google:BBBBBBBBBBBBBBBBBBBB' }))
    assert.throws(() => open(ring, { ...row, provider: 'meta' }))
    const tampered = Buffer.from(a.ciphertext); tampered[0] ^= 1
    assert.throws(() => open(ring, { ...row, ciphertext: tampered }))
  })
})

describe('cofre — PostgreSQL descartável (0019)', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  before(async () => { pool = await openLocalPool() })
  beforeEach(async () => { await resetIntelTables(pool) })
  after(async () => { await pool?.end() })

  it('guarda cifrado, usa só dentro do callback, nunca grava texto claro', async () => {
    const vault = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) }))
    const meta = await vault.store({ connectionId: 'x', provider: 'google', secret: 'segredo-ficticio-123', scopes: ['adwords'], expiresAt: null })
    assert.match(meta.ref, /^vault:mi-google:[A-Za-z0-9_-]{32}$/)
    const raw = (await pool.query(`SELECT ciphertext::text AS c, iv, auth_tag FROM crm.mi_credentials`)).rows[0]
    assert.ok(!String(raw.c).includes('segredo'))
    const dump = JSON.stringify((await pool.query(`SELECT * FROM crm.mi_credentials`)).rows)
    assert.ok(!dump.includes('segredo-ficticio'))
    assert.equal(await vault.withSecret(meta.ref, async s => s.length), 'segredo-ficticio-123'.length)
  })

  it('revogar apaga o material e impede uso; referência inválida recusada', async () => {
    const vault = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) }))
    const meta = await vault.store({ connectionId: 'x', provider: 'meta', secret: 'token-meta-ficticio', scopes: ['ads_read'], expiresAt: null })
    await vault.revoke(meta.ref)
    const row = (await pool.query(`SELECT octet_length(ciphertext) AS n, revoked_at FROM crm.mi_credentials`)).rows[0]
    assert.equal(row.n, 1); assert.ok(row.revoked_at)
    await assert.rejects(vault.withSecret(meta.ref, async s => s), /MI_VAULT_REF_NOT_FOUND/)
    await assert.rejects(vault.withSecret('nao-e-ref' as CredentialRef, async s => s), /MI_VAULT_REF_INVALID/)
  })

  it('rotação de chave: recifra para a versão atual sem mudar a referência; versão antiga pode sair depois', async () => {
    const v1 = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) }))
    const a = await v1.store({ connectionId: 'a', provider: 'google', secret: 'A-secreto', scopes: [], expiresAt: null })
    const b = await v1.store({ connectionId: 'b', provider: 'meta', secret: 'B-secreto', scopes: [], expiresAt: null })
    const v2 = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(1) + ',2:' + testKey(2), MI_VAULT_KEY_CURRENT: '2' }))
    assert.equal(await v2.rotate(1), 2)
    assert.equal(await v2.rotate(), 0, 'idempotente')
    const only2 = new PgCredentialVault(pool, parseKeyRing({ MI_VAULT_KEYS: '2:' + testKey(2) }))
    assert.equal(await only2.withSecret(a.ref, async s => s), 'A-secreto')
    assert.equal(await only2.withSecret(b.ref, async s => s), 'B-secreto')
    await only2.replace(a.ref, 'A-renovado', '2027-01-01T00:00:00Z')
    assert.equal(await only2.withSecret(a.ref, async s => s), 'A-renovado')
  })
})
