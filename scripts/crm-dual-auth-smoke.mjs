// Regression smoke: real password derivation + independent session invalidation; no network or customer data.
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'

const hash = (password) => {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return 'scrypt$16384$8$1$' + salt.toString('hex') + '$' + derived.toString('hex')
}

process.env.CRM_SESSION_SECRET = 'a'.repeat(64)
process.env.CRM_DATABASE_URL = 'postgresql://test:test@localhost:5432/crm_auth_smoke'
process.env.CRM_ADMIN_PASSWORD_HASH = hash('ADMIN-example-2026-Password!')
process.env.CRM_GUILHERME_PASSWORD_HASH = hash('GUILHERME-example-2026-Password!')

const auth = await import('../lib/crm/auth.ts')

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
