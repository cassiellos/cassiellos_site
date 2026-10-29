import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STUCK_RESERVATION_MINUTES, adminActorFromSession, authorizeAdminMutation } from './admin-actions'

describe('authorizeAdminMutation — permissões administrativas', () => {
  const ok = { vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json' }
  it('libera somente sessão válida, Preview, mesma origem e JSON', () => {
    assert.equal(authorizeAdminMutation(ok), null)
  })
  it('fora do Preview (produção/local) não existe', () => {
    assert.deepEqual(authorizeAdminMutation({ ...ok, vercelEnv: 'production' }), { status: 404, error: 'NOT_FOUND' })
    assert.deepEqual(authorizeAdminMutation({ ...ok, vercelEnv: undefined }), { status: 404, error: 'NOT_FOUND' })
  })
  it('sem sessão administrativa: 401', () => {
    assert.deepEqual(authorizeAdminMutation({ ...ok, sessionValid: false }), { status: 401, error: 'UNAUTHORIZED' })
  })
  it('outra origem (CSRF): 403; conteúdo não JSON: 400', () => {
    assert.deepEqual(authorizeAdminMutation({ ...ok, originAllowed: false }), { status: 403, error: 'FORBIDDEN' })
    assert.deepEqual(authorizeAdminMutation({ ...ok, contentType: 'text/plain' }), { status: 400, error: 'INVALID_REQUEST' })
    assert.deepEqual(authorizeAdminMutation({ ...ok, contentType: null }), { status: 400, error: 'INVALID_REQUEST' })
  })
})

describe('adminActorFromSession — auditoria sem expor a sessão', () => {
  it('referência estável, curta e não reversível', () => {
    const a = adminActorFromSession('cookie-assinado.abc')
    assert.deepEqual(a, adminActorFromSession('cookie-assinado.abc'))
    assert.equal(a.kind, 'crm_admin')
    assert.match(a.sessionRef, /^[0-9a-f]{16}$/)
    assert.equal(a.sessionRef.includes('cookie'), false)
    assert.notEqual(a.sessionRef, adminActorFromSession('outra-sessao').sessionRef)
  })
})

describe('reservas travadas', () => {
  it('consideradas travadas após 15 minutos em processamento', () => {
    assert.equal(STUCK_RESERVATION_MINUTES, 15)
  })
})
