import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertNoSecretsInPayload } from '../credential-vault'
import { auditForAdmin, publicAuditDetails } from './audit-public'

describe('sanitização do histórico administrativo', () => {
  it('reproduz o erro legado por "authorization" e o elimina apenas na projeção pública', () => {
    const original = {
      at: '2026-11-15T19:24:46.519Z',
      actor: 'admin-test',
      action: 'association_confirmed',
      entity: 'client_asset',
      entityId: 'b181e37c-0897-452f-ae76-82daaf319d91',
      details: {
        assetId: '76b132ef-5448-42db-aede-e2de453883bd',
        clientId: '764f0535-971f-4dcd-b0e5-f853fa66cc25',
        shared: false,
        authorization: 'user_explicit_2026-11-15',
      },
    }
    assert.throws(() => assertNoSecretsInPayload({ admin: { audit: [original] } }), /authorization/)
    const safe = auditForAdmin(original)
    assertNoSecretsInPayload({ admin: { audit: [safe] } })
    assert.deepEqual(safe.details, {
      assetId: original.details.assetId, clientId: original.details.clientId, shared: false,
    })
    assert.deepEqual(original.details.authorization, 'user_explicit_2026-11-15', 'evento original não é modificado')
    assert.equal(safe.action, original.action)
    assert.equal(safe.at, original.at)
  })

  it('bloqueia campos desconhecidos, aninhados e valores arbitrários, mesmo sob nomes inofensivos', () => {
    const details = {
      kind: 'client',
      financeLinked: false,
      status: 'vault:sensitive',
      source: 'refresh_fake',
      authorization: 'registro-privado',
      access_token: 'segredo',
      nested: { credential_ref: 'vault:fake', password: 'never' },
      count: 4,
      rows: -1,
      changed: ['name', 'finance_link', 'client_secret', { apiKey: 'never' }],
      clientId: 'INVALID',
    }
    const safe = publicAuditDetails(details)
    assert.deepEqual(safe, {
      kind: 'client', financeLinked: false, count: 4, changed: ['name', 'finance_link'],
    })
    assertNoSecretsInPayload({ admin: { audit: [{ details: safe }] } })
    assert.equal(details.authorization, 'registro-privado', 'sanitização não altera a entrada')
  })

  it('não publica estruturas de detalhes inválidas ou herdadas de fontes não confiáveis', () => {
    for (const v of [null, undefined, 'texto', ['token'], 7]) {
      assert.deepEqual(publicAuditDetails(v), {})
    }
    assert.deepEqual(publicAuditDetails({ status: 'succeeded', rows: 3, provider: 'google', shared: true }), {
      status: 'succeeded', shared: true, provider: 'google', rows: 3,
    })
  })
})
