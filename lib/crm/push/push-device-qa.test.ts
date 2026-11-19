import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('painel push testa somente a inscrição do próprio aparelho', () => {
  const ui = source('app/crm/notifications-panel.tsx')
  const api = source('lib/crm/push/admin-request.ts')
  const db = source('lib/crm/push/store.ts')
  assert.match(ui, /action: 'test', variant, deviceId: device.subscriptionId/)
  assert.match(ui, /Renovar inscrição neste aparelho/)
  assert.match(ui, /action: 'unsubscribe_self', endpoint: sub.endpoint/)
  assert.match(api, /subscriptionForEndpoint\(deps.pool, data.endpoint/)
  assert.match(api, /deviceId: sub\?\.id/)
  assert.match(db, /SELECT id, status FROM crm.push_subscriptions WHERE endpoint = \$1/)
  assert.doesNotMatch(ui, /action: 'test', variant \}/)
})
