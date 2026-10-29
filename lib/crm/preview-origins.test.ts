import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CRM_CANONICAL_ORIGIN,
  CRM_LEGACY_PREVIEW_ORIGIN,
  isAllowedOAuthRedirectHost,
  isCrmPreviewOrigin,
} from './preview-origins'

describe('isCrmPreviewOrigin', () => {
  it('aceita o domínio definitivo e o alias da branch durante a transição', () => {
    assert.equal(isCrmPreviewOrigin('https://crm.cassiellos.com.br'), true)
    assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN), true)
    assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), true)
  })

  it('rejeita qualquer outra origem (comparação exata)', () => {
    for (const origin of [
      null,
      undefined,
      '',
      'null',
      'http://crm.cassiellos.com.br',
      'https://crm.cassiellos.com.br/',
      'https://crm.cassiellos.com.br:443',
      'https://CRM.cassiellos.com.br',
      'https://evil-crm.cassiellos.com.br',
      'https://crm.cassiellos.com.br.evil.test',
      'https://cassiellos.com.br',
      'https://www.cassiellos.com.br',
      'https://agencia-cassiellos.vercel.app',
      'https://attacker.vercel.app',
    ]) {
      assert.equal(isCrmPreviewOrigin(origin), false, String(origin))
    }
  })
})

describe('isAllowedOAuthRedirectHost', () => {
  it('aceita crm.cassiellos.com.br e aliases *.vercel.app', () => {
    assert.equal(isAllowedOAuthRedirectHost('crm.cassiellos.com.br'), true)
    assert.equal(isAllowedOAuthRedirectHost(new URL(CRM_LEGACY_PREVIEW_ORIGIN).hostname), true)
  })

  it('rejeita o site institucional e hosts parecidos', () => {
    for (const host of ['cassiellos.com.br', 'www.cassiellos.com.br', 'crm.cassiellos.com.br.evil.test', 'vercel.app.evil.test']) {
      assert.equal(isAllowedOAuthRedirectHost(host), false, host)
    }
  })
})
