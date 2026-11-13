import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isIntelOriginAllowed } from './origin'

const crm = (o: string | null | undefined) => o === 'https://crm.cassiellos.com.br'
const env = { vercelEnv: 'preview', branchUrl: 'cassiellos-crm-git-feat-mi-foundation-mock-cassiellos-projects.vercel.app', deploymentUrl: 'cassiellos-abc123-cassiellos-projects.vercel.app' }

describe('Central — origem das ações (CSRF)', () => {
  it('Preview: aceita só a origem do próprio deploy informada pela Vercel, além das origens do CRM', () => {
    assert.equal(isIntelOriginAllowed('https://' + env.branchUrl, env, crm), true)
    assert.equal(isIntelOriginAllowed('https://' + env.deploymentUrl, env, crm), true)
    assert.equal(isIntelOriginAllowed('https://crm.cassiellos.com.br', env, crm), true)
    assert.equal(isIntelOriginAllowed('https://outro-deploy-cassiellos-projects.vercel.app', env, crm), false)
    assert.equal(isIntelOriginAllowed('http://' + env.branchUrl, env, crm), false)
    assert.equal(isIntelOriginAllowed('https://' + env.branchUrl + '.evil.com', env, crm), false)
    assert.equal(isIntelOriginAllowed(null, env, crm), false)
  })
  it('Production e fora da Vercel: nada além das origens do CRM', () => {
    assert.equal(isIntelOriginAllowed('https://' + env.branchUrl, { ...env, vercelEnv: 'production' }, crm), false)
    assert.equal(isIntelOriginAllowed('https://' + env.branchUrl, { ...env, vercelEnv: undefined }, crm), false)
    assert.equal(isIntelOriginAllowed('https://crm.cassiellos.com.br', { vercelEnv: 'production' }, crm), true)
  })
  it('valores de ambiente inválidos são ignorados', () => {
    assert.equal(isIntelOriginAllowed('https://evil.com', { vercelEnv: 'preview', branchUrl: 'evil.com' }, crm), false)
    assert.equal(isIntelOriginAllowed('https://', { vercelEnv: 'preview', branchUrl: '' }, crm), false)
  })
})
