import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

test('CRM: cron de retentativas é único, usa GET e não publica credenciais', () => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons?: { path: string; schedule: string }[]
  }
  assert.deepEqual(config.crons, [{
    path: '/api/crm/comms/sweep', schedule: '*/10 * * * *',
  }])
  const handler = readFileSync(resolve(process.cwd(), 'app/api/crm/comms/sweep/route.ts'), 'utf8')
  assert.match(handler, /export const GET = run/)
  assert.match(handler, /COMMS_SWEEP_SECRET/)
  assert.match(handler, /authorized\(request\.headers\.get\('authorization'\), secret\)/)
  assert.doesNotMatch(JSON.stringify(config), /(Bearer\s+[a-zA-Z0-9]{32}|secrets?\s*[:=]\s*['"])/i)
})
