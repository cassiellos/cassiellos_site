import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CRM_CANONICAL_ORIGIN,
  CRM_LEGACY_PREVIEW_ORIGIN,
  CRM_FORM_DESIGN_PREVIEW_ORIGIN,
  isAllowedOAuthRedirectHost,
  isCrmPreviewOrigin,
} from './preview-origins'

describe('isCrmPreviewOrigin', () => {
  it('aceita o domínio definitivo e o alias da branch durante a transição', () => {
    assert.equal(isCrmPreviewOrigin('https://crm.cassiellos.com.br'), true)
    assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN), true)
    assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), true)
    assert.equal(isCrmPreviewOrigin(CRM_FORM_DESIGN_PREVIEW_ORIGIN), true)
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
      'https://agencia-cassiellos-git-design-formul-5e3c88-cassiellos-projects.vercel.app.evil.test',
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

describe('origens por ambiente (Preview x Production)', () => {
  it('Preview mantém exatamente a lista original', () => {
    for (const origin of [CRM_CANONICAL_ORIGIN, CRM_LEGACY_PREVIEW_ORIGIN, CRM_FORM_DESIGN_PREVIEW_ORIGIN]) {
      assert.equal(isCrmPreviewOrigin(origin, 'preview'), true, origin)
    }
    assert.equal(isCrmPreviewOrigin('https://cassiellos-crm.vercel.app', 'preview'), false)
  })

  it('Production aceita somente o domínio definitivo (nenhum alias *.vercel.app)', () => {
    assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN, 'production'), true)
    for (const origin of [CRM_LEGACY_PREVIEW_ORIGIN, CRM_FORM_DESIGN_PREVIEW_ORIGIN, 'https://cassiellos-crm.vercel.app',
      'https://cassiellos-crm-cassiellos-projects.vercel.app', 'http://crm.cassiellos.com.br', 'https://crm.cassiellos.com.br/', null]) {
      assert.equal(isCrmPreviewOrigin(origin, 'production'), false, String(origin))
    }
  })

  it('callback OAuth em Production: somente crm.cassiellos.com.br', () => {
    assert.equal(isAllowedOAuthRedirectHost('crm.cassiellos.com.br', 'production'), true)
    for (const host of ['cassiellos-crm.vercel.app', new URL(CRM_LEGACY_PREVIEW_ORIGIN).hostname, 'cassiellos.com.br']) {
      assert.equal(isAllowedOAuthRedirectHost(host, 'production'), false, host)
    }
    assert.equal(isAllowedOAuthRedirectHost(new URL(CRM_LEGACY_PREVIEW_ORIGIN).hostname, 'preview'), true)
  })
})
