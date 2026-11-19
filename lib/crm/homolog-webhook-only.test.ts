import test from 'node:test'
import assert from 'node:assert/strict'
import { HOMOLOG_WEBHOOK_PATH, homologPathAllowed, homologWebhookOnly } from './homolog-webhook-only'

const ON = { CRM_HOMOLOG_WEBHOOK_ONLY: 'true', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'crm-homolog' }

test('portão ligado: só a rota do webhook passa', () => {
  assert.equal(homologWebhookOnly(ON), true)
  assert.equal(homologPathAllowed(ON, HOMOLOG_WEBHOOK_PATH), true)
  for (const p of ['/', '/agendar', '/formularios/escolas', '/crm', '/crm/login', '/api/booking/leads',
    '/api/public/forms/escolas', '/api/crm/leads', '/api/crm/comms/whatsapp-webhook/', '/api/crm/comms/whatsapp-webhookx',
    '/API/crm/comms/whatsapp-webhook', '/_next/static/x.js', '/politica-de-privacidade']) {
    assert.equal(homologPathAllowed(ON, p), false, p)
  }
})

test('portão inerte em Production, em outra branch, sem a variável ou com valor diferente de "true"', () => {
  for (const env of [
    { ...ON, VERCEL_ENV: 'production' },
    { ...ON, VERCEL_GIT_COMMIT_REF: 'crm-production' },
    { ...ON, CRM_HOMOLOG_WEBHOOK_ONLY: undefined },
    { ...ON, CRM_HOMOLOG_WEBHOOK_ONLY: 'TRUE' },
    { ...ON, CRM_HOMOLOG_WEBHOOK_ONLY: '1' },
    {},
  ]) {
    assert.equal(homologWebhookOnly(env), false)
    assert.equal(homologPathAllowed(env, '/agendar'), true)
  }
})
