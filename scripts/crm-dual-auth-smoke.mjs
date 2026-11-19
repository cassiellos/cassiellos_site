// Regression smoke: real password derivation + independent session invalidation; no network or customer data.
import assert from 'node:assert/strict'
import * as nodeCrypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const { randomBytes, scryptSync } = nodeCrypto

const hash = (password) => {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return 'scrypt$16384$8$1$' + salt.toString('hex') + '$' + derived.toString('hex')
}

process.env.CRM_SESSION_SECRET = 'a'.repeat(64)
process.env.CRM_DATABASE_URL = 'postgresql://test:test@localhost:5432/crm_auth_smoke'
process.env.CRM_ADMIN_PASSWORD_HASH = hash('ADMIN-example-2026-Password!')
process.env.CRM_GUILHERME_PASSWORD_HASH = hash('GUILHERME-example-2026-Password!')

// Load the auth module in a safe isolated Node VM so Next.js's bundler-only 'server-only'
 // marker and server aliases do not break this unit smoke test. No DB/network calls are made.
const raw = readFileSync(new URL('../lib/crm/auth.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(raw, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const isolatedModule = { exports: {} }
runInNewContext(compiled, {
  module: isolatedModule, exports: isolatedModule.exports, process, Buffer,
  require: (name) => {
    if (name === 'server-only') return {}
    if (name === 'node:crypto') return nodeCrypto
    if (name === '@/lib/crm/db') return { getCrmPool: () => { throw Error('Database not used by this smoke test') } }
    if (name === '@/lib/crm/homolog-mode') return { crmDatabaseUrl: () => process.env.CRM_DATABASE_URL }
    throw Error('Unexpected module in auth smoke: ' + name)
  },
}, { filename: 'lib/crm/auth.ts', timeout: 5_000 })
const auth = isolatedModule.exports

assert.equal(auth.isCrmAuthConfigured(), true)
assert.equal(await auth.verifyAdminCredentials('admin', 'ADMIN-example-2026-Password!'), true)
assert.equal(await auth.verifyAdminCredentials('GUILHERME', 'GUILHERME-example-2026-Password!'), true)
assert.equal(await auth.verifyAdminCredentials('admin', 'GUILHERME-example-2026-Password!'), false)
assert.equal(await auth.verifyAdminCredentials('guilherme', 'ADMIN-example-2026-Password!'), false)
assert.equal(await auth.verifyAdminCredentials('unregistered', 'ADMIN-example-2026-Password!'), false)

const adminToken = auth.issueCrmSession('admin')
const guilhermeToken = auth.issueCrmSession('guilherme')
assert.equal(auth.verifyCrmSession(adminToken), true)
assert.equal(auth.verifyCrmSession(guilhermeToken), true)
assert.notEqual(adminToken, guilhermeToken)

process.env.CRM_GUILHERME_PASSWORD_HASH = hash('GUILHERME-new-example-2026!')
assert.equal(auth.verifyCrmSession(guilhermeToken), false, 'Guilherme password rotation revokes his token')
assert.equal(auth.verifyCrmSession(adminToken), true, 'Admin remains logged in')
process.env.CRM_GUILHERME_PASSWORD_HASH = ''
assert.equal(auth.verifyCrmSession(guilhermeToken), false, 'Unconfigured account fails closed')
assert.equal(auth.verifyCrmSession(adminToken), true, 'Admin remains available')
process.env.CRM_ADMIN_PASSWORD_HASH = hash('ADMIN-new-example-2026-Password!')
assert.equal(auth.verifyCrmSession(adminToken), false, 'Admin password rotation revokes his token')
console.log('CRM individual-admin authentication smoke passed.')
