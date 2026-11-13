/**
 * COFRE REAL da Central de Inteligência (implementa `CredentialVault`).
 *
 * - AES-256-GCM, IV aleatório de 12 bytes por gravação, tag de 16 bytes. AAD = referência + plataforma (o texto cifrado de
 *   uma credencial não pode ser trocado de linha nem de plataforma sem falhar na abertura).
 * - Chaves PRÓPRIAS (`MI_VAULT_KEYS`, versão atual em `MI_VAULT_KEY_CURRENT`), separadas da chave do Google Calendar
 *   (`CRM_GOOGLE_ENCRYPTION_KEY`) — o cofre se recusa a funcionar se alguma chave coincidir com ela.
 * - O banco guarda só iv + texto cifrado + tag (crm.mi_credentials, migração 0019) e a referência opaca vai para
 *   crm.mi_connections.credential_ref. O segredo só existe em memória dentro de `withSecret`.
 * - Revogar apaga o material cifrado (fica 1 byte) e impede novo uso.
 * - Rotação: adicionar a nova versão em MI_VAULT_KEYS, apontar MI_VAULT_KEY_CURRENT para ela e executar `rotate()`;
 *   depois de concluída, a versão antiga pode sair de MI_VAULT_KEYS. (Procedimento em docs/marketing/central-inteligencia-fase2.md.)
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CREDENTIAL_REF_RE, type CredentialRef, type CredentialVault, type StoredCredentialMeta } from '../credential-vault'

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }

export type KeyRing = { current: number; keys: ReadonlyMap<number, Buffer> }

export class VaultConfigError extends Error {
  constructor(readonly reason: 'MISSING' | 'INVALID' | 'SHARED_WITH_CALENDAR') { super('MI_VAULT_' + reason); this.name = 'VaultConfigError' }
}

/** Lê o chaveiro: MI_VAULT_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>" e MI_VAULT_KEY_CURRENT="2". Erros nunca contêm valores. */
export function parseKeyRing(env: Record<string, string | undefined>): KeyRing {
  const raw = env.MI_VAULT_KEYS?.trim()
  if (!raw) throw new VaultConfigError('MISSING')
  const keys = new Map<number, Buffer>()
  for (const part of raw.split(',')) {
    const m = /^(\d{1,4}):([A-Za-z0-9+/=_-]{40,64})$/.exec(part.trim())
    if (!m) throw new VaultConfigError('INVALID')
    const key = Buffer.from(m[2], 'base64')
    const version = Number(m[1])
    if (key.length !== 32 || version < 1 || version > 1000 || keys.has(version)) throw new VaultConfigError('INVALID')
    keys.set(version, key)
  }
  const current = env.MI_VAULT_KEY_CURRENT ? Number(env.MI_VAULT_KEY_CURRENT) : Math.max(...keys.keys())
  if (!Number.isInteger(current) || !keys.has(current)) throw new VaultConfigError('INVALID')
  const calendar = env.CRM_GOOGLE_ENCRYPTION_KEY?.trim()
  if (calendar) {
    const candidates = [Buffer.from(calendar, 'base64'), Buffer.from(calendar, 'hex'), Buffer.from(calendar, 'utf8')]
    for (const k of keys.values()) if (candidates.some(c => c.length === k.length && timingSafeEqual(c, k))) throw new VaultConfigError('SHARED_WITH_CALENDAR')
  }
  return { current, keys }
}

const aad = (ref: string, provider: string) => Buffer.from(ref + '|' + provider, 'utf8')

export function newCredentialRef(provider: 'google' | 'meta'): CredentialRef {
  return ('vault:mi-' + provider + ':' + randomBytes(24).toString('base64url')) as CredentialRef
}

export function seal(ring: KeyRing, ref: string, provider: string, secret: string) {
  const key = ring.keys.get(ring.current)!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(ref, provider))
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return { keyVersion: ring.current, iv, ciphertext, authTag: cipher.getAuthTag() }
}

export function open(ring: KeyRing, row: { ref: string; provider: string; keyVersion: number; iv: Buffer; ciphertext: Buffer; authTag: Buffer }): string {
  const key = ring.keys.get(row.keyVersion)
  if (!key) throw new Error('MI_VAULT_KEY_VERSION_UNAVAILABLE')
  const decipher = createDecipheriv('aes-256-gcm', key, row.iv)
  decipher.setAAD(aad(row.ref, row.provider))
  decipher.setAuthTag(row.authTag)
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8')
}

/** Derivação de material auxiliar SEM armazenamento (ex.: verificador PKCE a partir do `state`). */
export function deriveFromVaultKey(ring: KeyRing, label: string, input: string): Buffer {
  return createHmac('sha256', ring.keys.get(ring.current)!).update(label + '\0' + input).digest()
}

const MAX_SECRET = 8000

export class PgCredentialVault implements CredentialVault {
  constructor(private readonly db: Queryable, private readonly ring: KeyRing) {}

  async store(input: { connectionId: string; provider: 'google' | 'meta'; secret: string; scopes: readonly string[]; expiresAt: string | null }): Promise<StoredCredentialMeta> {
    if (!input.secret || input.secret.length > MAX_SECRET) throw new Error('MI_VAULT_INVALID_SECRET')
    const ref = newCredentialRef(input.provider)
    const s = seal(this.ring, ref, input.provider, input.secret)
    await this.db.query(
      `INSERT INTO crm.mi_credentials (ref, provider, key_version, iv, ciphertext, auth_tag, scopes, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ref, input.provider, s.keyVersion, s.iv, s.ciphertext, s.authTag, [...input.scopes], input.expiresAt])
    return { ref, provider: input.provider, scopes: [...input.scopes], expiresAt: input.expiresAt, keyVersion: s.keyVersion }
  }

  /** Troca o segredo de uma referência existente (renovação de token de longa duração), mantendo a referência. */
  async replace(ref: CredentialRef, secret: string, expiresAt: string | null): Promise<void> {
    if (!CREDENTIAL_REF_RE.test(ref) || !secret || secret.length > MAX_SECRET) throw new Error('MI_VAULT_INVALID_SECRET')
    const { rows } = await this.db.query(`SELECT provider FROM crm.mi_credentials WHERE ref = $1 AND revoked_at IS NULL`, [ref])
    if (!rows[0]) throw new Error('MI_VAULT_REF_NOT_FOUND')
    const s = seal(this.ring, ref, String(rows[0].provider), secret)
    await this.db.query(`UPDATE crm.mi_credentials SET key_version = $2, iv = $3, ciphertext = $4, auth_tag = $5, expires_at = $6, rotated_at = now()
      WHERE ref = $1 AND revoked_at IS NULL`, [ref, s.keyVersion, s.iv, s.ciphertext, s.authTag, expiresAt])
  }

  async withSecret<T>(ref: CredentialRef, use: (secret: string) => Promise<T>): Promise<T> {
    if (!CREDENTIAL_REF_RE.test(ref)) throw new Error('MI_VAULT_REF_INVALID')
    const { rows } = await this.db.query(
      `SELECT ref, provider, key_version, iv, ciphertext, auth_tag FROM crm.mi_credentials WHERE ref = $1 AND revoked_at IS NULL`, [ref])
    const r = rows[0]
    if (!r) throw new Error('MI_VAULT_REF_NOT_FOUND')
    const secret = open(this.ring, { ref: String(r.ref), provider: String(r.provider), keyVersion: Number(r.key_version), iv: r.iv as Buffer, ciphertext: r.ciphertext as Buffer, authTag: r.auth_tag as Buffer })
    return use(secret)
  }

  async revoke(ref: CredentialRef): Promise<void> {
    if (!CREDENTIAL_REF_RE.test(ref)) throw new Error('MI_VAULT_REF_INVALID')
    await this.db.query(`UPDATE crm.mi_credentials SET revoked_at = now(), ciphertext = '\\x00'::bytea WHERE ref = $1 AND revoked_at IS NULL`, [ref])
  }

  /** Recifra com a chave atual tudo que ainda usa versões antigas. Devolve quantas credenciais foram recifradas. */
  async rotate(batch = 100): Promise<number> {
    let total = 0
    for (;;) {
      const { rows } = await this.db.query(
        `SELECT ref, provider, key_version, iv, ciphertext, auth_tag FROM crm.mi_credentials
          WHERE revoked_at IS NULL AND key_version <> $1 ORDER BY created_at LIMIT $2`, [this.ring.current, batch])
      if (!rows.length) return total
      for (const r of rows) {
        const ref = String(r.ref)
        const secret = open(this.ring, { ref, provider: String(r.provider), keyVersion: Number(r.key_version), iv: r.iv as Buffer, ciphertext: r.ciphertext as Buffer, authTag: r.auth_tag as Buffer })
        const s = seal(this.ring, ref, String(r.provider), secret)
        const res = await this.db.query(`UPDATE crm.mi_credentials SET key_version = $2, iv = $3, ciphertext = $4, auth_tag = $5, rotated_at = now()
          WHERE ref = $1 AND key_version = $6 AND revoked_at IS NULL`, [ref, s.keyVersion, s.iv, s.ciphertext, s.authTag, Number(r.key_version)])
        total += res.rowCount ?? 0
      }
    }
  }
}
