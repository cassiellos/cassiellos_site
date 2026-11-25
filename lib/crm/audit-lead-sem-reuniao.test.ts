import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { Pool, type QueryResult } from 'pg'

/**
 * Consulta de auditoria do "lead qualificado sem reunião" (scripts/tracking/auditoria-*.sql).
 * 1) Guardas estáticas (sempre rodam): só leitura, sem coluna com dado pessoal, papel com SELECT por coluna.
 * 2) Cenários em PostgreSQL DESCARTÁVEL com dados fictícios (só com CRM_INTEGRATION_DATABASE_URL; nunca o Neon).
 * A consulta NÃO foi executada em produção; ela só roda depois de autorização específica do titular.
 */

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const AUDIT_SQL = read('scripts/tracking/auditoria-lead-qualificado-sem-reuniao.sql')
const ROLE_SQL = read('scripts/tracking/auditoria-papel-somente-leitura.sql')
const stripComments = (sql: string) => sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')

// Colunas que carregam dado pessoal, segredo ou link privado: nunca podem ser lidas pela auditoria.
const FORBIDDEN_COLUMNS = [
  'full_name', 'email', 'whatsapp', 'company', 'notes', 'segment', 'service_interest', 'answers', 'client_ip', 'user_agent',
  'meeting_url', 'calendar_event_id', 'google_event_id', 'calendar_id', 'metadata', 'idempotency_key', 'fingerprint',
  'details', 'event_id', 'event_source_url', 'created_by', 'updated_by', 'revoked_by', 'reason', 'recipient', 'landing_url',
  'referrer_url', 'fbclid', 'fbc', 'fbp', 'visitor_key', 'payload',
]

describe('auditoria: guardas estáticas da consulta', () => {
  const code = stripComments(AUDIT_SQL)

  it('começa em transação SOMENTE LEITURA, limita tempo e termina em ROLLBACK', () => {
    const statements = code.split(';').map(part => part.trim()).filter(Boolean)
    assert.equal(statements[0], 'BEGIN READ ONLY')
    assert.match(code, /SET LOCAL statement_timeout = '5s'/)
    assert.match(code, /SET LOCAL lock_timeout = '1s'/)
    assert.equal(statements.at(-1), 'ROLLBACK')
    assert.equal(statements.filter(part => /^COMMIT\b/i.test(part)).length, 0)
  })

  it('só tem SELECT/WITH além do controle da transação (nada de escrita, DDL, cópia ou trava)', () => {
    const statements = code.split(';').map(part => part.trim()).filter(Boolean)
    for (const statement of statements) {
      assert.match(statement, /^(BEGIN READ ONLY|SET LOCAL [a-z_]+ = '[0-9a-z]+'|WITH\b|SELECT\b|ROLLBACK)/i, statement.slice(0, 60))
    }
    assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|MERGE|VACUUM|REINDEX|REFRESH|LOCK|NOTIFY|SET ROLE|SET SESSION)\b/i)
    assert.doesNotMatch(code, /\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i)
    assert.doesNotMatch(code, /\b(pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|pg_sleep)\b/i)
  })

  it('não referencia nenhuma coluna com dado pessoal, segredo ou link privado', () => {
    for (const column of FORBIDDEN_COLUMNS) {
      assert.doesNotMatch(code, new RegExp('\\b' + column + '\\b', 'i'), 'coluna proibida na consulta: ' + column)
    }
    assert.doesNotMatch(code, /\bSELECT\s+\*|\b\w+\.\*/i, 'nada de SELECT * nem alias.*')
  })

  it('o lead só aparece por referência curta e só leads reais entram', () => {
    assert.match(code, /left\(l\.id::text, 8\)\s+AS lead_ref/)
    assert.equal((code.match(/l\.is_test = false/g) ?? []).length, 2)
  })
})

describe('auditoria: guardas estáticas do papel de acesso mínimo', () => {
  const code = stripComments(ROLE_SQL)
  const grants = code.split(';').map(part => part.trim()).filter(part => /^GRANT\b/i.test(part))

  it('só concede USAGE no schema e SELECT por coluna', () => {
    assert.ok(grants.length >= 10)
    for (const grant of grants) {
      assert.match(grant, /^GRANT (USAGE ON SCHEMA crm TO crm_audit_ro|SELECT \([a-z_, ]+\)\s+ON crm\.[a-z_]+\s+TO crm_audit_ro)$/s, grant)
    }
    assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL PRIVILEGES|EXECUTE|SEQUENCE|REFERENCES|TRIGGER)\b/i)
  })

  it('nenhuma coluna com dado pessoal é concedida', () => {
    const granted = grants.join('\n')
    for (const column of FORBIDDEN_COLUMNS) {
      assert.doesNotMatch(granted, new RegExp('\\b' + column + '\\b', 'i'), 'coluna proibida no GRANT: ' + column)
    }
  })

  it('papel sem privilégios, limitado a 1 conexão, somente leitura por padrão e com expiração', () => {
    assert.match(code, /CREATE ROLE crm_audit_ro LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION\s+CONNECTION LIMIT 1 PASSWORD :'audit_password' VALID UNTIL :'audit_valid_until'/)
    assert.match(code, /ALTER ROLE crm_audit_ro SET default_transaction_read_only = on/)
    assert.match(code, /ALTER ROLE crm_audit_ro SET statement_timeout = '5s'/)
    assert.doesNotMatch(ROLE_SQL, /PASSWORD\s+'/, 'a senha nunca fica escrita no arquivo')
  })

  it('traz a remoção completa do papel', () => {
    assert.match(ROLE_SQL, /-- DROP OWNED BY crm_audit_ro;/)
    assert.match(ROLE_SQL, /-- DROP ROLE crm_audit_ro;/)
  })
})

// -----------------------------------------------------------------------------------------------------------------
const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

// Valores que NUNCA podem aparecer no resultado (ficam nas colunas com dado pessoal do cenário fictício).
const SENTINELS = [
  'SENTINELA Maria Fictícia', 'sentinela-', '@exemplo-auditoria.com', '31900099999', 'Hamburgueria Sentinela', 'nota-sentinela',
  'meet.google.com/sentinela', 'evento-google-sentinela', '203.0.113.99', 'token-sentinela',
]

type Row = Record<string, unknown>
type Scenario = {
  key: string; label: string; expected: string
  outcome: 'qualified' | 'limited'; isTest?: boolean
  booking?: { status: 'processing' | 'confirmed' | 'failed' | 'cancelled'; ageMinutes: number; failureCode?: string; withMeeting?: boolean }
  meeting?: { status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'rescheduled' | 'no_show' }
}

const SCENARIOS: Scenario[] = [
  { key: 'a', label: 'sem tentativa', expected: 'H_SEM_TENTATIVA_DE_AGENDAMENTO', outcome: 'qualified' },
  { key: 'b', label: 'reserva travada', expected: 'D_RESERVA_TRAVADA', outcome: 'qualified', booking: { status: 'processing', ageMinutes: 45 } },
  { key: 'c', label: 'reserva em andamento', expected: 'E_RESERVA_EM_ANDAMENTO', outcome: 'qualified', booking: { status: 'processing', ageMinutes: 2 } },
  { key: 'd', label: 'falha na reserva', expected: 'F_FALHA_NA_RESERVA_EXTERNAL_CALENDAR_CONFLICT', outcome: 'qualified', booking: { status: 'failed', ageMinutes: 60, failureCode: 'EXTERNAL_CALENDAR_CONFLICT' } },
  { key: 'e', label: 'reserva cancelada', expected: 'G_RESERVA_CANCELADA', outcome: 'qualified', booking: { status: 'cancelled', ageMinutes: 60 } },
  { key: 'f', label: 'reserva confirmada sem reunião (inconsistente)', expected: 'C_INCONSISTENTE_RESERVA_CONFIRMADA', outcome: 'qualified', booking: { status: 'confirmed', ageMinutes: 60 } },
  { key: 'g', label: 'com reunião confirmada', expected: 'A_TEM_REUNIAO', outcome: 'qualified', booking: { status: 'confirmed', ageMinutes: 60, withMeeting: true }, meeting: { status: 'confirmed' } },
  { key: 'h', label: 'reunião cancelada', expected: 'B_REUNIAO_ENCERRADA_CANCELLED', outcome: 'qualified', booking: { status: 'cancelled', ageMinutes: 60 }, meeting: { status: 'cancelled' } },
  { key: 'i', label: 'orçamento limitado (não é qualificado)', expected: '(fora)', outcome: 'limited' },
  { key: 'j', label: 'lead de teste (não é real)', expected: '(fora)', outcome: 'qualified', isTest: true },
]

describe('auditoria: cenários em PostgreSQL descartável (dados fictícios)', { skip }, () => {
  let pool: Pool
  const seeded = new Map<string, { leadId: string; ref: string }>()
  const suffix = randomUUID().slice(0, 6)

  const exec = async (sql: string, params: unknown[] = []) => pool.query(sql, params)

  async function runAudit(client: { query: (sql: string) => Promise<unknown> }) {
    const results = (await client.query(AUDIT_SQL)) as unknown as QueryResult[]
    const named = (field: string) => results.find(result => result.fields?.some(f => f.name === field))
    return {
      leads: (named('lead_ref')?.rows ?? []) as Row[],
      totals: (named('leads')?.rows ?? []) as Row[],
      agenda: (named('tipo')?.rows ?? []) as Row[],
      raw: JSON.stringify(results.map(result => ({ rows: result.rows, fields: result.fields?.map(f => f.name) }))),
    }
  }

  before(async () => {
    pool = new Pool({ connectionString: url, max: 4 })
    for (const scenario of SCENARIOS) {
      const lead = await exec(
        `INSERT INTO crm.leads (full_name, email, whatsapp, company, segment, notes, stage, is_test, created_at, updated_at)
         VALUES ('SENTINELA Maria Fictícia', $1, '31900099999', 'Hamburgueria Sentinela', 'Hamburgueria', 'nota-sentinela',
                 $2, $3, timestamptz '2026-11-10 12:00:00-03', timestamptz '2026-11-10 12:00:00-03') RETURNING id`,
        [`sentinela-${scenario.key}-${suffix}@exemplo-auditoria.com`, scenario.outcome === 'qualified' ? 'qualified' : 'new', scenario.isTest ?? false],
      )
      const leadId = lead.rows[0].id as string
      seeded.set(scenario.key, { leadId, ref: leadId.slice(0, 8) })
      const submission = await exec(
        `INSERT INTO crm.form_submissions (lead_id, form_version, answers, idempotency_key, status)
         VALUES ($1, 'hamburguerias-v1', $2::jsonb, $3, 'validated') RETURNING id`,
        [leadId, JSON.stringify({ contact: { name: 'SENTINELA Maria Fictícia', email: 'sentinela-' + scenario.key + '@exemplo-auditoria.com' }, token: 'token-sentinela' }),
          'audit-' + suffix + '-' + scenario.key],
      )
      const submissionId = submission.rows[0].id as string
      await exec(
        `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details, created_at)
         VALUES ($1, $2, 'public_flow', $3::jsonb, timestamptz '2026-11-10 12:00:30-03')`,
        [leadId, scenario.outcome === 'qualified' ? 'form_flow_qualified' : 'form_flow_budget_limited', JSON.stringify({ note: 'nota-sentinela' })],
      )
      await exec(
        `INSERT INTO crm.tracking_events (lead_id, event_id, event_name, source_category, event_source_url, metadata)
         VALUES ($1, $2, 'Lead', 'server', 'https://crm.cassiellos.com.br/formularios/hamburguerias', $3::jsonb)`,
        [leadId, 'lead_' + leadId.replaceAll('-', ''), JSON.stringify({ ip: '203.0.113.99' })],
      )
      let appointmentId: string | null = null
      if (scenario.meeting) {
        const appointment = await exec(
          `INSERT INTO crm.appointments (lead_id, starts_at, ends_at, status, calendar_event_id, meeting_url, confirmed_at, cancelled_at, is_test)
           VALUES ($1, timestamptz '2026-11-12 13:00:00-03', timestamptz '2026-11-12 13:30:00-03', $2, $3, 'https://meet.google.com/sentinela-' || $4,
                   CASE WHEN $2 IN ('confirmed','completed') THEN now() END, CASE WHEN $2 = 'cancelled' THEN now() END, $5) RETURNING id`,
          [leadId, scenario.meeting.status, 'evento-google-sentinela-' + scenario.key + suffix, scenario.key, scenario.isTest ?? false],
        )
        appointmentId = appointment.rows[0].id as string
      }
      if (scenario.booking) {
        await exec(
          `INSERT INTO crm.booking_requests (submission_id, lead_id, starts_at, ends_at, status, google_event_id, appointment_id, failure_code, created_at, updated_at)
           VALUES ($1, $2, timestamptz '2026-11-12 13:00:00-03' + make_interval(mins => $8::int),
                   timestamptz '2026-11-12 13:30:00-03' + make_interval(mins => $8::int), $3, $4, $5, $6,
                   now() - make_interval(mins => $7::int), now())`,
          [submissionId, leadId, scenario.booking.status,
            scenario.booking.status === 'confirmed' ? 'evento-google-sentinela-b' + scenario.key + suffix : null,
            scenario.booking.withMeeting ? appointmentId : null, scenario.booking.failureCode ?? null, scenario.booking.ageMinutes,
            SCENARIOS.indexOf(scenario) * 30],
        )
      }
    }
  })

  after(async () => {
    const ids = [...seeded.values()].map(item => item.leadId)
    if (ids.length) {
      await exec('DELETE FROM crm.booking_requests WHERE lead_id = ANY($1::uuid[])', [ids])
      await exec('DELETE FROM crm.appointments WHERE lead_id = ANY($1::uuid[])', [ids])
      await exec('DELETE FROM crm.tracking_events WHERE lead_id = ANY($1::uuid[])', [ids])
      await exec('DELETE FROM crm.lead_activities WHERE lead_id = ANY($1::uuid[])', [ids])
      await exec('DELETE FROM crm.form_submissions WHERE lead_id = ANY($1::uuid[])', [ids])
      await exec('DELETE FROM crm.leads WHERE id = ANY($1::uuid[])', [ids])
    }
    await pool?.end()
  })

  it('cada desfecho recebe o diagnóstico esperado; limitado e lead de teste ficam de fora', async () => {
    const client = await pool.connect()
    try {
      const { leads } = await runAudit(client)
      for (const scenario of SCENARIOS) {
        const ref = seeded.get(scenario.key)!.ref
        const row = leads.find(item => item.lead_ref === ref)
        if (scenario.expected === '(fora)') { assert.equal(row, undefined, scenario.label); continue }
        assert.ok(row, 'faltou o lead do cenário: ' + scenario.label)
        assert.equal(row.diagnostico, scenario.expected, scenario.label)
        assert.equal(row.tem_evento_lead_no_crm, true, scenario.label)
      }
    } finally { client.release() }
  })

  it('as colunas devolvidas são só as previstas e nenhum dado pessoal vaza (nem do jsonb nem de colunas)', async () => {
    const client = await pool.connect()
    try {
      const { leads, raw } = await runAudit(client)
      assert.deepEqual(Object.keys(leads[0]).sort(), [
        'diagnostico', 'envios_qualificados', 'etapa_no_crm', 'lead_ref', 'minutos_desde_a_qualificacao', 'qualificado_em_brasilia',
        'qualificado_em_utc', 'reserva_codigo_de_falha', 'reserva_horario_brasilia', 'reserva_status', 'reuniao_status',
        'tem_evento_lead_no_crm', 'tem_evento_schedule_no_crm',
      ])
      for (const sentinel of SENTINELS) assert.equal(raw.includes(sentinel), false, 'vazou: ' + sentinel)
      for (const row of leads) assert.match(String(row.lead_ref), /^[0-9a-f]{8}$/)
    } finally { client.release() }
  })

  it('os totais da consulta 2 batem com os registros da consulta 1', async () => {
    const client = await pool.connect()
    try {
      const { leads, totals } = await runAudit(client)
      const byDiagnosis = new Map<string, number>()
      for (const row of leads) byDiagnosis.set(String(row.diagnostico), (byDiagnosis.get(String(row.diagnostico)) ?? 0) + 1)
      assert.deepEqual(
        Object.fromEntries(totals.map(row => [row.diagnostico, Number(row.leads)])),
        Object.fromEntries(byDiagnosis),
      )
    } finally { client.release() }
  })

  it('a consulta 3 traz a configuração da agenda sem texto livre', async () => {
    const client = await pool.connect()
    try {
      const { agenda, raw } = await runAudit(client)
      assert.ok(agenda.some(row => row.tipo === 'configuracao'))
      assert.ok(agenda.some(row => row.tipo === 'capacidade_diaria'))
      assert.equal(raw.includes('reason'), false)
    } finally { client.release() }
  })

  it('a transação é somente leitura: qualquer gravação é recusada pelo banco e nada fica gravado', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await assert.rejects(client.query("UPDATE crm.leads SET stage = 'new'"), (error: { code?: string }) => error.code === '25006')
      await client.query('ROLLBACK')
      const after = await runAudit(client)
      assert.ok(after.leads.length >= 8)
      const open = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = pg_backend_pid() AND state = 'idle in transaction'")
      assert.equal(open.rows[0].n, 0, 'a auditoria encerra a transação com ROLLBACK')
    } finally { client.release() }
  })

  describe('papel de acesso mínimo (precisa de superusuário no banco descartável)', () => {
    const roleName = 'crm_audit_ro'
    let rolePool: Pool | null = null
    let setupSkipped: string | null = null

    before(async () => {
      try {
        await exec(`DROP OWNED BY ${roleName}`).catch(() => undefined)
        await exec(`DROP ROLE IF EXISTS ${roleName}`)
        const setup = ROLE_SQL.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
          .replace(":'audit_password'", "'senha-descartavel'").replace(":'audit_valid_until'", "'2099-01-01'")
        await exec(setup)
        const base = new URL(url as string)
        base.username = roleName
        base.password = 'senha-descartavel'
        rolePool = new Pool({ connectionString: base.toString(), max: 1 })
      } catch (error) {
        setupSkipped = 'sem permissão para criar o papel: ' + (error as Error).message
      }
    })
    after(async () => {
      await rolePool?.end()
      if (!setupSkipped) {
        await exec(`REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM ${roleName}`)
        await exec(`REVOKE ALL ON SCHEMA crm FROM ${roleName}`)
        await exec(`DROP OWNED BY ${roleName}`)
        await exec(`DROP ROLE ${roleName}`)
      }
    })

    it('executa a consulta inteira só com as colunas concedidas e devolve o mesmo resultado do titular', async (t) => {
      if (setupSkipped) return t.skip(setupSkipped)
      const owner = await pool.connect()
      const restricted = await rolePool!.connect()
      try {
        const [ownerRun, roleRun] = [await runAudit(owner), await runAudit(restricted)]
        const strip = (rows: Row[]) => rows.map(row => ({ ...row, minutos_desde_a_qualificacao: 0 }))
        assert.deepEqual(strip(roleRun.leads), strip(ownerRun.leads))
        assert.deepEqual(roleRun.totals, ownerRun.totals)
        assert.deepEqual(roleRun.agenda, ownerRun.agenda)
      } finally { owner.release(); restricted.release() }
    })

    it('o banco recusa dados pessoais, SELECT *, escrita e criação de objetos para o papel', async (t) => {
      if (setupSkipped) return t.skip(setupSkipped)
      const denied = (error: { code?: string }) => error.code === '42501'
      for (const sql of [
        'SELECT full_name FROM crm.leads', 'SELECT email FROM crm.leads', 'SELECT whatsapp FROM crm.leads', 'SELECT notes FROM crm.leads',
        'SELECT * FROM crm.leads', 'SELECT answers FROM crm.form_submissions', 'SELECT idempotency_key FROM crm.form_submissions',
        'SELECT meeting_url FROM crm.appointments', 'SELECT calendar_event_id FROM crm.appointments',
        'SELECT google_event_id FROM crm.booking_requests', 'SELECT details FROM crm.lead_activities',
        'SELECT metadata FROM crm.tracking_events', 'SELECT event_id FROM crm.tracking_events',
        'SELECT reason FROM crm.availability_blocks', 'SELECT client_ip FROM crm.visitors',
        'SELECT * FROM crm.integration_credentials', 'SELECT * FROM crm.push_subscriptions',
      ]) {
        await assert.rejects(rolePool!.query(sql), denied, sql)
      }
      // Escrita: o padrão do papel já é somente leitura (25006). Mesmo forçando uma transação de leitura e
      // escrita, falta permissão em todas as tabelas (42501): são duas travas independentes.
      const writes = [
        "INSERT INTO crm.leads (full_name) VALUES ('x')", "UPDATE crm.leads SET stage = 'new'", 'DELETE FROM crm.booking_requests',
        'CREATE TABLE crm.audit_probe (id int)', 'CREATE TABLE public.audit_probe (id int)', 'TRUNCATE crm.leads',
      ]
      for (const sql of writes) {
        await assert.rejects(rolePool!.query(sql), (error: { code?: string }) => error.code === '25006', 'padrão somente leitura: ' + sql)
        const client = await rolePool!.connect()
        try {
          await client.query('BEGIN READ WRITE')
          await assert.rejects(client.query(sql), denied, 'sem permissão: ' + sql)
        } finally { await client.query('ROLLBACK').catch(() => undefined); client.release() }
      }
      const mode = await rolePool!.query("SELECT current_setting('default_transaction_read_only') AS value")
      assert.equal(mode.rows[0].value, 'on', 'o papel deve iniciar somente leitura')
    })
  })
})
