import { execFile } from 'node:child_process'

/**
 * Integração Asaas — FASE 2.2B: leitura da chave Sandbox do COFRE DE CREDENCIAIS do sistema operacional, somente em
 * tempo de execução, pelo processo que vai usá-la.
 *
 *  - macOS: Keychain, via /usr/bin/security (find-generic-password -w).
 *  - Linux: Secret Service (GNOME Keyring/KWallet), via secret-tool lookup.
 *
 * A chave NUNCA vem de variável de ambiente, argumento de linha de comando, arquivo .env ou banco. O valor é lido
 * pela saída padrão do utilitário diretamente para a memória deste processo (sem shell, sem arquivo temporário,
 * sem eco no terminal) e só é entregue ao cliente HTTP, que o guarda em closure. Erros viram códigos curtos e não
 * incluem a saída do utilitário. O formato é conferido: só chave de Sandbox; chave de produção é recusada.
 *
 * O titular grava a chave com o utilitário do sistema em modo interativo (entrada oculta) — ver
 * docs/crm/asaas-sandbox-credencial.md. Este módulo não grava, não lista e não apaga credenciais.
 */

export const KEYCHAIN_SERVICE = 'cassiellos-crm-asaas-sandbox'
export const KEYCHAIN_ACCOUNT = 'api-key'

const SANDBOX_KEY = /^\$aact_hmlg_[A-Za-z0-9_\-:.=+/]{16,400}$/
const PRODUCTION_KEY = /^\$aact_prod_/

export class AsaasCredentialError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AsaasCredentialError' }
}

/** Execução de utilitário sem shell (injetável para testes com credencial fictícia). */
export type ExecFileFn = (file: string, args: readonly string[], opts: { timeout: number; maxBuffer: number; windowsHide: boolean; shell: false },
  cb: (err: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void) => unknown

const defaultExec: ExecFileFn = (file, args, opts, cb) => execFile(file, [...args], { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => cb(err, String(stdout), String(stderr)))

export type CredentialSource = { platform?: NodeJS.Platform; exec?: ExecFileFn; service?: string; account?: string }

function command(platform: NodeJS.Platform, service: string, account: string): [string, string[]] {
  if (platform === 'darwin') return ['/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']]
  if (platform === 'linux') return ['secret-tool', ['lookup', 'service', service, 'account', account]]
  throw new AsaasCredentialError('CREDENTIAL_STORE_UNSUPPORTED')
}

/** Lê a chave Sandbox do cofre do sistema. Nunca imprime, registra ou devolve o valor em erros. */
export async function loadSandboxKey(src: CredentialSource = {}): Promise<string> {
  const service = src.service ?? KEYCHAIN_SERVICE
  const account = src.account ?? KEYCHAIN_ACCOUNT
  if (!/^[a-z0-9-]{3,80}$/.test(service) || !/^[a-z0-9-]{3,80}$/.test(account)) throw new AsaasCredentialError('INVALID_CREDENTIAL_NAME')
  const [file, args] = command(src.platform ?? process.platform, service, account)
  const exec = src.exec ?? defaultExec
  const out = await new Promise<string>((resolve, reject) => {
    exec(file, args, { timeout: 60_000, maxBuffer: 4096, windowsHide: true, shell: false }, (err, stdout) => {
      if (err) {
        // Sem a mensagem/saída do utilitário (podem ecoar parâmetros). Só o tipo de falha.
        return reject(new AsaasCredentialError(err.code === 'ENOENT' ? 'CREDENTIAL_STORE_UNAVAILABLE' : 'CREDENTIAL_NOT_FOUND'))
      }
      resolve(stdout)
    })
  })
  const key = out.replace(/\r?\n$/, '')
  if (!key) throw new AsaasCredentialError('CREDENTIAL_NOT_FOUND')
  if (PRODUCTION_KEY.test(key)) throw new AsaasCredentialError('PRODUCTION_KEY_REFUSED')
  if (!SANDBOX_KEY.test(key)) throw new AsaasCredentialError('INVALID_SANDBOX_KEY_FORMAT')
  return key
}
