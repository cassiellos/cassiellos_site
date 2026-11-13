/**
 * CONTRATO do armazenamento seguro de credenciais da Central de Inteligência (somente interface).
 *
 * A fundação NÃO implementa criptografia nem guarda segredos: a solução (algoritmo, chave, rotação, eventual serviço
 * de cofre) será decidida e aprovada numa missão própria. O que fica fixado aqui é o contrato que o resto do módulo
 * pode usar sem conhecer a implementação:
 *
 * - O banco (`crm.mi_connections.credential_ref`) guarda apenas uma REFERÊNCIA opaca, nunca o segredo em claro.
 * - O segredo só existe em memória no servidor, durante a chamada ao conector; nunca vai para o navegador, logs,
 *   relatórios ou payloads de API (ver `assertNoSecretsInPayload`).
 * - Separado do Google Calendar: não reutiliza `crm.integration_credentials` nem `CRM_GOOGLE_ENCRYPTION_KEY`.
 * - Revogar = invalidar a referência e marcar a conexão como `revoked` (trilha em `mi_audit_log`).
 */

export type CredentialRef = string & { readonly __brand: 'CredentialRef' }

export type StoredCredentialMeta = {
  ref: CredentialRef
  provider: 'google' | 'meta'
  scopes: readonly string[]
  /** Quando a plataforma informa (ex.: token de usuário Meta ~60 dias). Token de sistema pode não expirar. */
  expiresAt: string | null
  keyVersion: number
}

export interface CredentialVault {
  /** Guarda o segredo e devolve a referência opaca. */
  store(input: { connectionId: string; provider: 'google' | 'meta'; secret: string; scopes: readonly string[]; expiresAt: string | null }): Promise<StoredCredentialMeta>
  /** Usa o segredo SOMENTE dentro do callback (nada é devolvido para fora). */
  withSecret<T>(ref: CredentialRef, use: (secret: string) => Promise<T>): Promise<T>
  revoke(ref: CredentialRef): Promise<void>
}

/** Implementação da fundação: recusa qualquer uso. Garante que nenhum segredo real é aceito nesta fase. */
export const NO_VAULT: CredentialVault = {
  async store() { throw new Error('MI_VAULT_NOT_CONFIGURED') },
  async withSecret() { throw new Error('MI_VAULT_NOT_CONFIGURED') },
  async revoke() { throw new Error('MI_VAULT_NOT_CONFIGURED') },
}

/** Formato aceito para a referência opaca (validado também por CHECK na migração 0017). */
export const CREDENTIAL_REF_RE = /^vault:[a-z0-9-]{1,32}:[A-Za-z0-9_-]{16,128}$/

const SECRET_KEY_RE = /(token|secret|password|senha|credential|refresh|authorization|api[_-]?key|client[_-]?secret)/i

/**
 * Verifica (em testes e antes de responder à interface) que um payload não contém chaves com aparência de segredo.
 * Lança erro com o caminho da primeira chave proibida.
 */
export function assertNoSecretsInPayload(value: unknown, path = '$'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecretsInPayload(v, path + '[' + i + ']')); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) throw new Error('chave proibida no payload: ' + path + '.' + k)
      assertNoSecretsInPayload(v, path + '.' + k)
    }
  }
}
