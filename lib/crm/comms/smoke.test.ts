import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizeSmoke, SMOKE_DEDUPE_KEY, SMOKE_FROM, SMOKE_RECIPIENT } from './smoke'

const token = 'a'.repeat(48)

test('smoke: only one fixed recipient and sender', () => {
  assert.equal(SMOKE_RECIPIENT, 'cassiellosagencia@gmail.com')
  assert.equal(SMOKE_FROM, 'Agência Cassiellos <agendamentos@cassiellos.com.br>')
  assert.equal(SMOKE_DEDUPE_KEY, 'crm-resend-smoke-20261119-single')
})

test('smoke: valid bearer token in production with automation off', () => {
  assert.equal(authorizeSmoke({ serverToken: token, authorization: 'Bearer ' + token, environment: 'production', activeAutomations: false }), true)
})

test('smoke: rejects preview, wrong or missing bearer tokens, and active automations', () => {
  assert.equal(authorizeSmoke({ serverToken: token, authorization: 'Bearer ' + token, environment: 'preview' }), false)
  assert.equal(authorizeSmoke({ serverToken: token, authorization: 'Bearer wrong', environment: 'production' }), false)
  assert.equal(authorizeSmoke({ serverToken: token, authorization: '', environment: 'production' }), false)
  assert.equal(authorizeSmoke({ serverToken: 'tiny', authorization: 'Bearer tiny', environment: 'production' }), false)
  assert.equal(authorizeSmoke({ serverToken: token, authorization: 'Bearer ' + token, environment: 'production', activeAutomations: true }), false)
})
