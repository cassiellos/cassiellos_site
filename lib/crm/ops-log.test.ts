import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { confirmBookingRequest, type ConfirmDeps } from './booking-confirmation'
import { OPS_CODES, OPS_STAGES, buildOpsLogEntry, classifyDbError, dbErrorKind, opsCodeFrom, opsLog } from './ops-log'

// Textos que NUNCA podem aparecer em um registro, em nenhum campo.
const SENTINELS = [
  'maria.silva@example.com', '+5531998765432', '(31) 99876-5432', '203.0.113.77', 'Mozilla/5.0 (X11; Linux x86_64)',
  'XXXX.DUMMY.TOKEN.XXXX', 'bookingToken-abc123', 'Maria da Silva', '@hamburgueriadamaria', 'cassiellos_consent=',
  'postgresql://crm_owner:super-secret@ep-x.neon.tech/db', 'lead_0123456789abcdef0123456789abcdef',
]

function lines(input: unknown): string[] {
  const out: string[] = []
  opsLog(input as never, line => out.push(line))
  return out
}

describe('registros operacionais: só campos permitidos', () => {
  it('um registro válido sai em uma linha JSON com versão e etiqueta', () => {
    const out = lines({ stage: 'form_submit', code: 'SECURITY_CHECK_FAILED', status: 403, reason: 'expired_or_reused', cfCodes: ['timeout-or-duplicate'], form: 'hamburguerias' })
    assert.equal(out.length, 1)
    assert.deepEqual(JSON.parse(out[0]), {
      log: 'cassiellos_ops', v: 1, stage: 'form_submit', code: 'SECURITY_CHECK_FAILED', status: 403,
      reason: 'expired_or_reused', cf: ['timeout-or-duplicate'], form: 'hamburguerias',
    })
  })

  it('descarta qualquer campo fora da lista, mesmo com dados pessoais dentro', () => {
    const hostile = {
      stage: 'form_submit', code: 'SECURITY_CHECK_FAILED', status: 403,
      email: SENTINELS[0], phone: SENTINELS[1], ip: SENTINELS[3], userAgent: SENTINELS[4], token: SENTINELS[5],
      bookingToken: SENTINELS[6], name: SENTINELS[7], answers: { instagram: SENTINELS[8] }, cookie: SENTINELS[9],
      message: SENTINELS[10], leadId: SENTINELS[11], headers: { 'x-forwarded-for': SENTINELS[3] },
    }
    const [line] = lines(hostile)
    for (const text of SENTINELS) assert.equal(line.includes(text), false, text)
    assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['code', 'log', 'stage', 'status', 'v'])
  })

  it('campos permitidos também filtram o conteúdo: valores com cara de dado pessoal são descartados', () => {
    const entry = buildOpsLogEntry({
      stage: 'form_submit', code: 'OTHER', status: 99999,
      reason: SENTINELS[0], form: SENTINELS[7], dbKind: SENTINELS[10],
      cfCodes: [SENTINELS[3], SENTINELS[5], 'invalid-input-response', 'Maria da Silva'],
    })
    assert.ok(entry)
    assert.deepEqual(entry, { log: 'cassiellos_ops', v: 1, stage: 'form_submit', code: 'OTHER', cf: ['invalid-input-response'] })
    const text = JSON.stringify(entry)
    for (const sentinel of SENTINELS) assert.equal(text.includes(sentinel), false, sentinel)
  })

  it('estágio ou código fora da lista fechada: nada é registrado', () => {
    assert.equal(buildOpsLogEntry({ stage: 'qualquer', code: 'OTHER' }), null)
    assert.equal(buildOpsLogEntry({ stage: 'form_submit', code: 'Maria da Silva' }), null)
    assert.equal(buildOpsLogEntry({ stage: 'form_submit', code: SENTINELS[0] }), null)
    assert.equal(buildOpsLogEntry(null), null)
    assert.equal(buildOpsLogEntry('texto'), null)
    assert.equal(lines({ stage: 'x', code: 'y' }).length, 0)
  })

  it('no máximo 5 códigos da Cloudflare', () => {
    const entry = buildOpsLogEntry({ stage: 'form_submit', code: 'SECURITY_CHECK_FAILED', cfCodes: Array.from({ length: 9 }, (_, i) => 'erro-' + i + 'aa') })
    assert.equal(entry?.cf?.length, 5)
  })

  it('nunca lança erro, mesmo se o destino do registro falhar', () => {
    assert.doesNotThrow(() => opsLog({ stage: 'form_submit', code: 'OTHER' }, () => { throw new Error('sink quebrado') }))
    assert.doesNotThrow(() => opsLog(undefined as never))
  })

  it('a lista de códigos tem só identificadores técnicos em maiúsculas', () => {
    for (const code of OPS_CODES) assert.match(code, /^[A-Z][A-Z_]{2,40}$/)
    for (const stage of OPS_STAGES) assert.match(stage, /^[a-z_]{3,30}$/)
  })

  it('opsCodeFrom: códigos desconhecidos viram OTHER, nunca o texto recebido', () => {
    assert.equal(opsCodeFrom('SLOT_UNAVAILABLE'), 'SLOT_UNAVAILABLE')
    assert.equal(opsCodeFrom(SENTINELS[0]), 'OTHER')
    assert.equal(opsCodeFrom(undefined), 'OTHER')
  })
})

describe('classificação de erros de banco: só a categoria, nunca a mensagem', () => {
  const cases: Array<[unknown, string]> = [
    [new Error('Connection terminated due to connection timeout'), 'CONNECTION_TIMEOUT'],
    [new Error('timeout exceeded when trying to connect'), 'POOL_CONNECT_TIMEOUT'],
    [new Error('Connection terminated unexpectedly'), 'CONNECTION_TERMINATED'],
    [new Error('password authentication failed for user "cassiellos_crm_owner"'), 'AUTH_FAILED'],
    [new Error('Query read timeout'), 'QUERY_TIMEOUT'],
    [Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }), 'STATEMENT_TIMEOUT'],
    [Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'NETWORK:ECONNRESET'],
    [Object.assign(new Error('x'), { code: '57P01' }), 'SQLSTATE:57P01'],
    [Object.assign(new Error('x'), { code: 401 }), 'HTTP:401'],
    [Object.assign(new Error('x'), { name: 'CrmDatabaseConfigError' }), 'CONFIG'],
    [new Error('qualquer outra coisa'), 'UNKNOWN'],
    [null, 'UNKNOWN'],
    ['texto solto', 'UNKNOWN'],
  ]
  for (const [error, expected] of cases) {
    it(expected + ' <= ' + String((error as Error | null)?.message ?? error), () => {
      assert.equal(dbErrorKind(error), expected)
    })
  }

  it('a mensagem original, mesmo com cadeia de conexão e senha dentro, nunca vai para o resultado', () => {
    const error = new Error('password authentication failed: ' + SENTINELS[10] + ' ' + SENTINELS[0])
    const kind = dbErrorKind(error)
    assert.equal(kind, 'AUTH_FAILED')
    for (const sentinel of SENTINELS) assert.equal(kind.includes(sentinel), false)
    assert.deepEqual(classifyDbError(error), { kind: 'AUTH_FAILED', detail: null })
  })
})

describe('confirmação: aviso de falha inesperada não muda a resposta', () => {
  const session = { leadId: 'lead', submissionId: 'sub', formSlug: 'hamburguerias' } as never
  const form = { slug: 'hamburguerias', durationMinutes: 30, meetingName: 'Diagnóstico' } as never
  const deps = (extra: Partial<ConfirmDeps>): ConfirmDeps => ({
    pool: {} as never, verifySession: () => session, getForm: () => form, readBusy: async () => [],
    createEvent: async () => { throw new Error('não deveria chegar aqui') }, calendarId: 'primary', allowedEmail: 'a@example.com',
    loadRules: async () => { throw new Error('Connection terminated due to connection timeout') },
    ...extra,
  })
  const input = { bookingToken: 'token', startAt: '2026-12-02T13:00:00.000Z', pageOrigin: 'https://crm.cassiellos.com.br' }

  it('falha inesperada: 503 BOOKING_REQUIRES_REVIEW e o aviso recebe o erro', async () => {
    let seen: unknown
    const result = await confirmBookingRequest(deps({ onUnexpectedError: error => { seen = error } }), input)
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { error: 'BOOKING_REQUIRES_REVIEW' })
    assert.equal(dbErrorKind(seen), 'CONNECTION_TIMEOUT')
  })

  it('se o aviso lançar erro, a resposta é a mesma', async () => {
    const result = await confirmBookingRequest(deps({ onUnexpectedError: () => { throw new Error('log quebrado') } }), input)
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { error: 'BOOKING_REQUIRES_REVIEW' })
  })

  it('sem o aviso (testes e chamadas internas) o comportamento é o de sempre', async () => {
    const result = await confirmBookingRequest(deps({}), input)
    assert.equal(result.status, 503)
  })
})

describe('ligação nas rotas: cada chamada usa só os campos permitidos', () => {
  const files = [
    'app/api/public/forms/[slug]/route.ts', 'app/api/booking/availability/route.ts', 'app/api/booking/calendar/route.ts',
    'app/api/booking/confirm/route.ts', 'app/formularios/[slug]/page.tsx',
  ]
  const ALLOWED = new Set(['stage', 'code', 'status', 'reason', 'cfCodes', 'dbKind', 'form'])

  for (const file of files) {
    it(file + ': só chaves permitidas e nada de IP, token, cabeçalhos ou corpo', () => {
      const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
      const calls = [...source.matchAll(/opsLog\(\{([^}]*)\}\)/g)].map(match => match[1])
      assert.ok(calls.length > 0 || file.endsWith('confirm/route.ts'), 'sem chamada de registro')
      for (const body of calls) {
        const keys = [...body.matchAll(/(^|[,{\s])(\w+)\s*:/g)].map(match => match[2])
        for (const key of keys) assert.ok(ALLOWED.has(key), file + ': chave não permitida "' + key + '"')
        assert.doesNotMatch(body, /headers|cookie|ip\b|forwarded|token\b|email|phone|name\b|answers|body|request\./i, file)
      }
    })
  }

  it('o slug da URL (não confiável) nunca é registrado; só o slug de formulário já encontrado', () => {
    const source = readFileSync(new URL('../../app/api/public/forms/[slug]/route.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /ops\(slug,/)
    assert.match(source, /ops\('',\s*'FORM_NOT_AVAILABLE'/)
    assert.match(source, /ops\(knownForm,\s*'FORM_SUBMISSION_UNAVAILABLE'/)
  })

  it('as rotas registram os pontos cegos conhecidos: Turnstile, calendário, disponibilidade e confirmação', () => {
    const form = readFileSync(new URL('../../app/api/public/forms/[slug]/route.ts', import.meta.url), 'utf8')
    assert.match(form, /SECURITY_CHECK_FAILED[^]*reason:token\.reason,cfCodes:token\.codes/)
    assert.match(form, /'SECURITY_CHECK_UNAVAILABLE'/)
    assert.match(form, /'FORM_SUBMISSION_UNAVAILABLE'/)
    assert.match(readFileSync(new URL('../../app/api/booking/calendar/route.ts', import.meta.url), 'utf8'), /stage: 'booking_calendar'/)
    assert.match(readFileSync(new URL('../../app/api/booking/availability/route.ts', import.meta.url), 'utf8'), /stage: 'booking_availability'/)
    const confirm = readFileSync(new URL('../../app/api/booking/confirm/route.ts', import.meta.url), 'utf8')
    assert.match(confirm, /stage: 'booking_confirm'/)
    assert.match(confirm, /onUnexpectedError/)
  })
})
