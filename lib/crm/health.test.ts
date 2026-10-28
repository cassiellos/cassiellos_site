import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as route from '@/app/api/crm/health/route'
import {
  CRM_EXPECTED_TABLES,
  handleCrmHealthRequest,
  isAuthorizedBearer,
  type CrmHealthDeps,
} from './health'

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
const FAKE_DB_SECRET = 'postgresql://crm_owner:super-secret-password@db.example.test/cassiellos_crm'

function request(authorization?: string) {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new Request('https://preview.example.test/api/crm/health', { headers })
}

function deps(overrides: Partial<CrmHealthDeps> = {}) {
  let calls = 0
  const value: CrmHealthDeps = {
    healthcheckToken: TOKEN,
    databaseConfigured: true,
    checkTables: async () => {
      calls += 1
      return CRM_EXPECTED_TABLES
    },
    ...overrides,
  }
  return { value, calls: () => calls }
}

async function read(response: Response) {
  const text = await response.text()
  return { text, body: JSON.parse(text) as Record<string, unknown> }
}

describe('handleCrmHealthRequest — configuração ausente', () => {
  for (const [label, token] of [['indefinido', undefined], ['vazio', ''], ['curto demais', 'short-token']] as const) {
    it(`nega acesso quando CRM_HEALTHCHECK_TOKEN está ${label}`, async () => {
      const d = deps({ healthcheckToken: token })
      const res = await handleCrmHealthRequest(request(`Bearer ${TOKEN}`), d.value)
      const { body } = await read(res)
      assert.equal(res.status, 503)
      assert.equal(body.error, 'HEALTHCHECK_NOT_CONFIGURED')
      assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
      assert.equal(d.calls(), 0, 'não pode consultar o banco')
    })
  }

  it('nega quando CRM_DATABASE_URL não está configurada (após autenticar)', async () => {
    const d = deps({ databaseConfigured: false })
    const res = await handleCrmHealthRequest(request(`Bearer ${TOKEN}`), d.value)
    const { body } = await read(res)
    assert.equal(res.status, 503)
    assert.equal(body.error, 'DATABASE_NOT_CONFIGURED')
    assert.equal(d.calls(), 0)
  })
})

describe('handleCrmHealthRequest — autorização negada', () => {
  const cases: Array<[string, string | undefined]> = [
    ['sem header Authorization', undefined],
    ['header vazio', ''],
    ['token incorreto', 'Bearer wrong-token-0123456789abcdef0123456789abcdef'],
    ['token com prefixo correto mas incompleto', `Bearer ${TOKEN.slice(0, -1)}`],
    ['esquema Basic', `Basic ${TOKEN}`],
    ['token sem esquema', TOKEN],
    ['Bearer sem token', 'Bearer '],
    ['header gigante', `Bearer ${'a'.repeat(5000)}`],
  ]
  for (const [label, header] of cases) {
    it(`retorna 401 — ${label}`, async () => {
      const d = deps()
      const res = await handleCrmHealthRequest(request(header), d.value)
      const { text, body } = await read(res)
      assert.equal(res.status, 401)
      assert.equal(body.ok, false)
      assert.equal(body.error, 'UNAUTHORIZED')
      assert.equal(res.headers.get('www-authenticate'), 'Bearer')
      assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
      assert.ok(!text.includes(TOKEN), 'nunca retorna o token configurado')
      assert.equal(d.calls(), 0, 'não pode consultar o banco')
    })
  }
})

describe('handleCrmHealthRequest — respostas autorizadas (banco simulado)', () => {
  it('200 quando as 10 tabelas existem', async () => {
    const res = await handleCrmHealthRequest(request(`bearer ${TOKEN}`), deps().value)
    const { body } = await read(res)
    assert.equal(res.status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.tables, { expected: 10, found: 10, missing: [] })
  })

  it('503 SCHEMA_INCOMPLETE lista apenas nomes de tabelas ausentes', async () => {
    const d = deps({ checkTables: async () => CRM_EXPECTED_TABLES.filter((t) => t !== 'leads') })
    const res = await handleCrmHealthRequest(request(`Bearer ${TOKEN}`), d.value)
    const { body } = await read(res)
    assert.equal(res.status, 503)
    assert.equal(body.error, 'SCHEMA_INCOMPLETE')
    assert.deepEqual(body.tables, { expected: 10, found: 9, missing: ['leads'] })
  })

  it('erro do banco não vaza mensagem, connection string ou token', async () => {
    const originalError = console.error
    const logged: string[] = []
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
    try {
      const d = deps({
        checkTables: async () => {
          throw Object.assign(new Error(`connect failed for ${FAKE_DB_SECRET}`), { code: 'ECONNREFUSED' })
        },
      })
      const res = await handleCrmHealthRequest(request(`Bearer ${TOKEN}`), d.value)
      const { text, body } = await read(res)
      assert.equal(res.status, 503)
      assert.equal(body.error, 'DATABASE_UNAVAILABLE')
      for (const output of [text, ...logged]) {
        assert.ok(!output.includes('super-secret-password'), 'sem senha')
        assert.ok(!output.includes('postgresql://'), 'sem connection string')
        assert.ok(!output.includes(TOKEN), 'sem token')
      }
      assert.ok(logged.some((line) => line.includes('ECONNREFUSED')), 'registra só o código técnico')
    } finally {
      console.error = originalError
    }
  })
})

describe('isAuthorizedBearer', () => {
  it('aceita somente o token exato', () => {
    assert.equal(isAuthorizedBearer(`Bearer ${TOKEN}`, TOKEN), true)
    assert.equal(isAuthorizedBearer(`Bearer ${TOKEN}x`, TOKEN), false)
    assert.equal(isAuthorizedBearer(null, TOKEN), false)
  })
})

describe('app/api/crm/health/route.ts', () => {
  const saved = { token: process.env.CRM_HEALTHCHECK_TOKEN, db: process.env.CRM_DATABASE_URL }
  beforeEach(() => {
    delete process.env.CRM_HEALTHCHECK_TOKEN
    delete process.env.CRM_DATABASE_URL
  })
  afterEach(() => {
    if (saved.token === undefined) delete process.env.CRM_HEALTHCHECK_TOKEN
    else process.env.CRM_HEALTHCHECK_TOKEN = saved.token
    if (saved.db === undefined) delete process.env.CRM_DATABASE_URL
    else process.env.CRM_DATABASE_URL = saved.db
  })

  it('usa runtime Node.js, sem cache', () => {
    assert.equal(route.runtime, 'nodejs')
    assert.equal(route.dynamic, 'force-dynamic')
  })

  it('sem CRM_HEALTHCHECK_TOKEN no servidor: 503 e nenhuma consulta', async () => {
    const res = await route.GET(request(`Bearer ${TOKEN}`))
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, 'HEALTHCHECK_NOT_CONFIGURED')
  })

  it('token incorreto: 401', async () => {
    process.env.CRM_HEALTHCHECK_TOKEN = TOKEN
    const res = await route.GET(request('Bearer wrong-token-0123456789abcdef0123456789abcdef'))
    assert.equal(res.status, 401)
  })

  it('token correto sem CRM_DATABASE_URL: 503 DATABASE_NOT_CONFIGURED', async () => {
    process.env.CRM_HEALTHCHECK_TOKEN = TOKEN
    const res = await route.GET(request(`Bearer ${TOKEN}`))
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, 'DATABASE_NOT_CONFIGURED')
  })
})
