/**
 * Fase 2.2B — leitura da chave do cofre do sistema, testada com utilitário SIMULADO e credenciais FICTÍCIAS.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AsaasCredentialError, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, loadSandboxKey, type ExecFileFn } from './credential'
import { FAKE_PRODUCTION_KEY, FAKE_SANDBOX_KEY } from './fixtures'

function fakeExec(result: { stdout?: string; error?: { code?: unknown } }) {
  const calls: { file: string; args: readonly string[]; opts: Record<string, unknown> }[] = []
  const exec: ExecFileFn = (file, args, opts, cb) => {
    calls.push({ file, args, opts })
    setImmediate(() => cb(result.error ? Object.assign(new Error('falhou: ' + (result.stdout ?? '')), result.error) : null, result.stdout ?? '', 'stderr com ' + (result.stdout ?? '')))
    return undefined
  }
  return { exec, calls }
}
const codeOf = (c: string) => (e: unknown) => e instanceof AsaasCredentialError && e.code === c

describe('credencial Sandbox — cofre do sistema', () => {
  it('macOS: lê do Keychain via /usr/bin/security sem shell; a chave nunca está nos argumentos', async () => {
    const f = fakeExec({ stdout: FAKE_SANDBOX_KEY + '\n' })
    assert.equal(await loadSandboxKey({ platform: 'darwin', exec: f.exec }), FAKE_SANDBOX_KEY)
    assert.deepEqual(f.calls[0].file, '/usr/bin/security')
    assert.deepEqual(f.calls[0].args, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'])
    assert.equal(f.calls[0].opts.shell, false)
    assert.ok(!f.calls[0].args.join(' ').includes('aact'))
  })
  it('Linux: Secret Service via secret-tool lookup', async () => {
    const f = fakeExec({ stdout: FAKE_SANDBOX_KEY })
    assert.equal(await loadSandboxKey({ platform: 'linux', exec: f.exec }), FAKE_SANDBOX_KEY)
    assert.deepEqual([f.calls[0].file, ...f.calls[0].args], ['secret-tool', 'lookup', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT])
  })
  it('chave de produção é recusada e o erro não contém o valor', async () => {
    const err = await loadSandboxKey({ platform: 'darwin', exec: fakeExec({ stdout: FAKE_PRODUCTION_KEY }).exec }).catch((e: Error) => e)
    assert.ok(codeOf('PRODUCTION_KEY_REFUSED')(err))
    assert.ok(!JSON.stringify(err).includes('aact') && !String((err as Error).stack).includes(FAKE_PRODUCTION_KEY))
  })
  it('formato inválido, vazio, ausente, cofre indisponível e plataforma sem suporte: códigos curtos', async () => {
    await assert.rejects(loadSandboxKey({ platform: 'darwin', exec: fakeExec({ stdout: 'qualquer-coisa' }).exec }), codeOf('INVALID_SANDBOX_KEY_FORMAT'))
    await assert.rejects(loadSandboxKey({ platform: 'darwin', exec: fakeExec({ stdout: '' }).exec }), codeOf('CREDENTIAL_NOT_FOUND'))
    await assert.rejects(loadSandboxKey({ platform: 'darwin', exec: fakeExec({ error: { code: 44 } }).exec }), codeOf('CREDENTIAL_NOT_FOUND'))
    await assert.rejects(loadSandboxKey({ platform: 'linux', exec: fakeExec({ error: { code: 'ENOENT' } }).exec }), codeOf('CREDENTIAL_STORE_UNAVAILABLE'))
    await assert.rejects(loadSandboxKey({ platform: 'win32', exec: fakeExec({}).exec }), codeOf('CREDENTIAL_STORE_UNSUPPORTED'))
    await assert.rejects(loadSandboxKey({ platform: 'darwin', service: 'x; rm -rf /', exec: fakeExec({}).exec }), codeOf('INVALID_CREDENTIAL_NAME'))
  })
  it('falha do utilitário com a chave na saída: o erro devolvido não a carrega', async () => {
    const err = await loadSandboxKey({ platform: 'darwin', exec: fakeExec({ stdout: FAKE_SANDBOX_KEY, error: { code: 1 } }).exec }).catch((e: Error) => e)
    assert.ok(codeOf('CREDENTIAL_NOT_FOUND')(err))
    assert.ok(!JSON.stringify(err).includes('aact') && !(err as Error).message.includes('aact') && !String((err as Error).stack).includes('aact'))
  })
  it('nunca lê variáveis de ambiente: uma chave em process.env é ignorada', async () => {
    process.env.ASAAS_API_KEY = FAKE_SANDBOX_KEY
    try {
      await assert.rejects(loadSandboxKey({ platform: 'darwin', exec: fakeExec({ error: { code: 44 } }).exec }), codeOf('CREDENTIAL_NOT_FOUND'))
    } finally { delete process.env.ASAAS_API_KEY }
  })
})
