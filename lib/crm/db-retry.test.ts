import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { describe, it } from 'node:test'
import { Pool } from 'pg'
import { CRM_DB_LIMITS } from './db'
import { DB_RETRY_DEFAULTS, isTransientDbError, retryTransient } from './db-retry'
import { classifyDbError } from './ops-log'

/**
 * Testes ISOLADOS da correção de conexão com o Neon: nenhum acesso ao Neon, à Vercel ou a produção.
 * Dois níveis: (1) lógica de nova tentativa com relógio e espera simulados; (2) comportamento real do driver "pg"
 * contra um servidor TCP local que simula um banco suspenso (não responde) ou que derruba a conexão.
 */

const coldStart = () => new Error('Connection terminated due to connection timeout')

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return { now: () => t, sleeps, sleep: async (ms: number) => { sleeps.push(ms); t += ms } }
}

describe('nova tentativa: lógica (relógio simulado)', () => {
  it('sucesso na primeira tentativa: nenhuma espera, nenhuma repetição', async () => {
    const clock = fakeClock()
    let calls = 0
    const value = await retryTransient(async () => { calls += 1; return 'ok' }, clock)
    assert.equal(value, 'ok'); assert.equal(calls, 1); assert.deepEqual(clock.sleeps, [])
  })

  it('início a frio: falha duas vezes e responde na terceira, com espera crescente de 300 ms e 900 ms', async () => {
    const clock = fakeClock()
    let calls = 0
    const retries: number[] = []
    const value = await retryTransient(async () => {
      calls += 1
      if (calls < 3) throw coldStart()
      return 'formulário'
    }, { ...clock, onRetry: info => retries.push(info.attempt) })
    assert.equal(value, 'formulário'); assert.equal(calls, 3)
    assert.deepEqual(clock.sleeps, [300, 900]); assert.deepEqual(retries, [1, 2])
  })

  it('esgotadas as tentativas: relança o erro ORIGINAL (nada é engolido)', async () => {
    const clock = fakeClock()
    const original = coldStart()
    let calls = 0
    await assert.rejects(retryTransient(async () => { calls += 1; throw original }, clock), error => error === original)
    assert.equal(calls, DB_RETRY_DEFAULTS.attempts)
  })

  it('erros que NÃO são de conexão nunca são repetidos: autenticação, configuração, SQL e erro comum', async () => {
    const errors = [
      new Error('password authentication failed for user "x"'),
      Object.assign(new Error('x'), { name: 'CrmDatabaseConfigError' }),
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
      Object.assign(new Error('duplicate key'), { code: '23505' }),
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
      new Error('qualquer outra coisa'),
    ]
    for (const error of errors) {
      const clock = fakeClock()
      let calls = 0
      await assert.rejects(retryTransient(async () => { calls += 1; throw error }, clock), e => e === error)
      assert.equal(calls, 1, String(error.message))
    }
  })

  it('erros de conexão que valem nova tentativa', () => {
    const transient = [
      coldStart(), new Error('timeout exceeded when trying to connect'), new Error('Connection terminated unexpectedly'),
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('x'), { code: '57P03' }), Object.assign(new Error('x'), { code: '08006' }),
    ]
    for (const error of transient) assert.equal(isTransientDbError(error), true, String(error.message) + ' ' + String((error as { code?: string }).code))
  })

  it('orçamento de tempo: uma tentativa lenta não dispara outra depois do orçamento (o visitante não espera sem fim)', async () => {
    const clock = fakeClock()
    let calls = 0
    // A primeira tentativa "demorou" o orçamento inteiro (relógio simulado): não há tempo para outra.
    await assert.rejects(retryTransient(async () => { calls += 1; throw coldStart() },
      { now: () => (calls >= 1 ? DB_RETRY_DEFAULTS.budgetMs : 0), sleep: clock.sleep }))
    assert.equal(calls, 1)
    assert.deepEqual(clock.sleeps, [])
  })

  it('padrões: 3 tentativas, 300 ms x3, orçamento de 9 s; tempo de conexão do pool de 10 s', () => {
    assert.equal(DB_RETRY_DEFAULTS.attempts, 3)
    assert.equal(DB_RETRY_DEFAULTS.baseDelayMs, 300)
    assert.equal(DB_RETRY_DEFAULTS.factor, 3)
    assert.equal(DB_RETRY_DEFAULTS.budgetMs, 9_000)
    assert.equal(CRM_DB_LIMITS.connectionTimeoutMs, 10_000)
  })
})

const openSockets = new WeakMap<Server, Set<Socket>>()

function listen(onConnection: (socket: Socket, count: number) => void): Promise<{ server: Server; port: number; count: () => number }> {
  return new Promise(resolve => {
    let count = 0
    const sockets = new Set<Socket>()
    const server = createServer(socket => {
      count += 1
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => undefined)
      onConnection(socket, count)
    })
    openSockets.set(server, sockets)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, count: () => count }))
  })
}
// Encerra as conexões ainda abertas antes de fechar o servidor, senão o fechamento nunca termina.
const closeServer = (server: Server) => new Promise<void>(resolve => {
  for (const socket of openSockets.get(server) ?? []) socket.destroy()
  server.close(() => resolve())
})

describe('driver pg contra servidor local que simula o Neon suspenso (sem rede externa)', () => {
  it('banco que não responde: o tempo de conexão é respeitado, o erro é de conexão e é repetido 3 vezes', async () => {
    const stalled = await listen(() => { /* aceita e nunca responde */ })
    const pool = new Pool({ host: '127.0.0.1', port: stalled.port, user: 'u', database: 'd', ssl: false, max: 1, connectionTimeoutMillis: 150 })
    try {
      const startedAt = Date.now()
      let kind = ''
      await assert.rejects(retryTransient(() => pool.query('select 1'), { baseDelayMs: 10, factor: 2, budgetMs: 5_000 }), error => {
        kind = classifyDbError(error).kind
        return true
      })
      const elapsed = Date.now() - startedAt
      assert.equal(kind === 'POOL_CONNECT_TIMEOUT' || kind === 'CONNECTION_TIMEOUT', true, kind)
      assert.equal(stalled.count(), 3, 'três conexões (uma por tentativa)')
      assert.ok(elapsed >= 3 * 150, 'respeitou o tempo limite em cada tentativa: ' + elapsed)
      assert.ok(elapsed < 3_000, 'não passou muito do orçamento: ' + elapsed)
    } finally { await pool.end().catch(() => undefined); await closeServer(stalled.server) }
  })

  it('conexão derrubada pelo servidor: erro de conexão e 3 tentativas', async () => {
    const dropping = await listen(socket => socket.destroy())
    const pool = new Pool({ host: '127.0.0.1', port: dropping.port, user: 'u', database: 'd', ssl: false, max: 1, connectionTimeoutMillis: 500 })
    try {
      let transient = false
      await assert.rejects(retryTransient(() => pool.query('select 1'), { baseDelayMs: 5, factor: 2, budgetMs: 5_000 }), error => {
        transient = isTransientDbError(error)
        return true
      })
      assert.equal(transient, true)
      assert.equal(dropping.count(), 3)
    } finally { await pool.end().catch(() => undefined); await closeServer(dropping.server) }
  })
})

describe('onde a nova tentativa vale: só leituras idempotentes; nada de gravação', () => {
  const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')

  it('página do formulário e regras de disponibilidade/calendário usam retryTransient', () => {
    assert.match(read('app/formularios/[slug]/page.tsx'), /retryTransient\(\(\)=>getPublishedFlow\(/)
    assert.match(read('app/api/booking/availability/route.ts'), /retryTransient\(\(\) => loadAvailabilityRules\(/)
    assert.match(read('app/api/booking/calendar/route.ts'), /retryTransient\(\(\) => loadAvailabilityRules\(/)
  })

  it('envio do lead, reserva, confirmação e criação de evento NÃO são repetidos automaticamente', () => {
    for (const path of [
      'app/api/public/forms/[slug]/route.ts', 'app/api/booking/confirm/route.ts', 'lib/crm/booking-confirmation.ts',
      'lib/crm/lead-intake.ts', 'lib/crm/booking-reservation.ts', 'lib/crm/google-calendar.ts',
    ]) {
      assert.doesNotMatch(read(path), /retryTransient/, path)
    }
  })

  it('o novo tempo de conexão está no pool e nenhum outro limite foi afrouxado', () => {
    assert.equal(CRM_DB_LIMITS.maxConnections, 3)
    assert.equal(CRM_DB_LIMITS.idleTimeoutMs, 10_000)
    assert.equal(CRM_DB_LIMITS.queryTimeoutMs, 8_000)
    assert.equal(CRM_DB_LIMITS.statementTimeoutMs, 5_000)
  })
})
