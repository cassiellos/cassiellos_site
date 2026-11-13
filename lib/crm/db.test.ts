import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Client } from 'pg'
import { buildCrmPoolConfig, CRM_DB_LIMITS, CrmDatabaseConfigError, intelDatabaseTarget, isCrmDatabaseConfigured } from './db'

const BASE = 'postgresql://crm_owner:super-secret-password@ep-example-pooler.sa-east-1.aws.neon.tech/cassiellos_crm'

/** SSL efetivo que o driver "pg" usará (sem abrir conexão). */
function effectiveSsl(connectionString: string) {
  const client = new Client(buildCrmPoolConfig(connectionString)) as unknown as {
    connectionParameters: { ssl: unknown; host: string; database: string }
  }
  return client.connectionParameters
}

describe('buildCrmPoolConfig', () => {
  it('sem CRM_DATABASE_URL: erro MISSING', () => {
    assert.equal(isCrmDatabaseConfigured(undefined), false)
    assert.equal(isCrmDatabaseConfigured('   '), false)
    assert.throws(() => buildCrmPoolConfig(undefined), (e) => e instanceof CrmDatabaseConfigError && e.reason === 'MISSING')
  })

  it('URL inválida: erro INVALID sem ecoar o valor', () => {
    for (const bad of ['not a url with secret-value', 'https://user:secret-value@example.test/db']) {
      assert.throws(() => buildCrmPoolConfig(bad), (e) => {
        assert.ok(e instanceof CrmDatabaseConfigError)
        assert.equal(e.reason, 'INVALID')
        assert.ok(!e.message.includes('secret-value'))
        return true
      })
    }
  })

  it('mantém validação de certificado mesmo com sslmode=require do Neon', () => {
    const params = effectiveSsl(`${BASE}?sslmode=require&channel_binding=require`)
    assert.deepEqual(params.ssl, { rejectUnauthorized: true })
    assert.equal(params.host, 'ep-example-pooler.sa-east-1.aws.neon.tech')
    assert.equal(params.database, 'cassiellos_crm')
  })

  it('ignora parâmetros que desativariam a validação (no-verify, uselibpqcompat)', () => {
    for (const query of ['sslmode=no-verify', 'uselibpqcompat=true&sslmode=require', 'ssl=false', 'sslmode=disable']) {
      assert.deepEqual(effectiveSsl(`${BASE}?${query}`).ssl, { rejectUnauthorized: true }, query)
    }
  })

  it('aplica limites e timeouts', () => {
    const config = buildCrmPoolConfig(BASE)
    assert.equal(config.max, CRM_DB_LIMITS.maxConnections)
    assert.equal(config.connectionTimeoutMillis, CRM_DB_LIMITS.connectionTimeoutMs)
    assert.equal(config.idleTimeoutMillis, CRM_DB_LIMITS.idleTimeoutMs)
    assert.equal(config.query_timeout, CRM_DB_LIMITS.queryTimeoutMs)
    assert.equal(config.allowExitOnIdle, true)
  })
})

describe('Central de Inteligência — isolamento e ativação do cadastro definitivo', () => {
  const base = { VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true', MI_DATA_MODE: 'real' }
  it('mantém o isolamento enquanto só a chave do sandbox está ativa', () => {
    assert.equal(intelDatabaseTarget({ ...base, MI_SANDBOX_ENABLED: 'true' }), 'sandbox')
  })
  it('acessa o banco definitivo somente com habilitação explícita e sandbox desligado', () => {
    assert.equal(intelDatabaseTarget({ ...base, MI_SANDBOX_ENABLED: 'false', MI_PRODUCTION_DATABASE_ENABLED: 'true' }), 'production')
  })
  it('falha fechado com ambas ou nenhuma ativação em Production', () => {
    for (const flags of [{}, { MI_SANDBOX_ENABLED: 'true', MI_PRODUCTION_DATABASE_ENABLED: 'true' }]) {
      assert.throws(() => intelDatabaseTarget({ ...base, ...flags }), CrmDatabaseConfigError)
    }
  })
  it('não autoriza Production se o guard principal do CRM não estiver ativo', () => {
    assert.throws(() => intelDatabaseTarget({ ...base, CRM_PRODUCTION_ENABLED: 'false', MI_PRODUCTION_DATABASE_ENABLED: 'true' }), CrmDatabaseConfigError)
  })
  it('mantém o banco do próprio ambiente em Preview e o padrão demo', () => {
    assert.equal(intelDatabaseTarget({ ...base, VERCEL_ENV: 'preview', MI_PRODUCTION_DATABASE_ENABLED: 'true' }), 'default')
    assert.equal(intelDatabaseTarget({ ...base, MI_DATA_MODE: 'demo' }), 'default')
  })
})
