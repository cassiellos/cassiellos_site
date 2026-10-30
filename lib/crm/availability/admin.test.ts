import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { availabilityOverview, handleAvailabilityAction } from './admin'
import { DEFAULT_AVAILABILITY_RULES } from './engine'
import { buildRange, loadAvailabilityRules, parseLocalTime } from './store'
import { confirmBookingRequest, type ConfirmDeps } from '../booking-confirmation'
import { getBookingForm } from '../booking-forms'

type Call = { sql: string; params?: unknown[] }
function fakeDb(handler: (sql: string) => unknown = () => ({ rows: [], rowCount: 0 })) {
  const calls: Call[] = []
  return {
    calls,
    query: (async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      const result = handler(sql)
      if (result instanceof Error) throw result
      return result
    }) as never,
  }
}
const missingTable = () => Object.assign(new Error('relation does not exist'), { code: '42P01' })

describe('disponibilidade — leitura, entrada do painel e ações', () => {
  it('sem a migração 0008 (42P01): usa o padrão do código, inclusive feriados', async () => {
    const rules = await loadAvailabilityRules(fakeDb(() => missingTable()))
    assert.equal(rules.source, 'defaults')
    assert.deepEqual(rules.settings, DEFAULT_AVAILABILITY_RULES.settings)
  })

  it('qualquer outro erro de banco é propagado (o chamador falha fechado)', async () => {
    await assert.rejects(loadAvailabilityRules(fakeDb(() => Object.assign(new Error('timeout'), { code: '57014' }))))
  })

  it('configuração inválida no banco é recusada (não oferece horários com regra corrompida)', async () => {
    const db = fakeDb(sql => sql.includes('availability_settings')
      ? { rows: [{ working_days: [1], open_minute: 100, close_minute: 1080, slot_minutes: 30, min_notice_minutes: 720, window_days: 30 }] }
      : { rows: [] })
    await assert.rejects(loadAvailabilityRules(db), /AVAILABILITY_SETTINGS_INVALID/)
  })

  it('conversão de datas/horas locais para instantes (-03:00)', () => {
    assert.equal(parseLocalTime('09:30'), 570)
    assert.equal(parseLocalTime('24:00'), null)
    assert.deepEqual(buildRange({ date: '2026-11-04' }),
      { startsAt: '2026-11-04T03:00:00.000Z', endsAt: '2026-11-05T03:00:00.000Z', partial: false })
    assert.deepEqual(buildRange({ date: '2026-11-05', startTime: '12:00', endTime: '14:00' }),
      { startsAt: '2026-11-05T15:00:00.000Z', endsAt: '2026-11-05T17:00:00.000Z', partial: true })
    assert.equal(buildRange({ date: '2026-11-05', startTime: '14:00', endTime: '12:00' }), null)
    assert.equal(buildRange({ date: '2026-11-10', endDate: '2026-11-09' }), null)
    assert.equal(buildRange({ date: '2026-01-01', endDate: '2027-06-01' }), null) // > 366 dias
    assert.equal(buildRange({ date: 'ontem' }), null)
  })

  it('toda ação exige confirmed:true e ação conhecida — nada é gravado sem isso', async () => {
    const db = fakeDb()
    assert.deepEqual(await handleAvailabilityAction(db, { action: 'add_block', date: '2026-11-04' }, 'a'),
      { status: 400, body: { error: 'CONFIRMATION_REQUIRED' } })
    assert.deepEqual(await handleAvailabilityAction(db, { action: 'drop_table', confirmed: true }, 'a'),
      { status: 400, body: { error: 'INVALID_ACTION' } })
    assert.deepEqual(await handleAvailabilityAction(db, { action: 'cancel_meeting', confirmed: true }, 'a'),
      { status: 400, body: { error: 'INVALID_ACTION' } })
    assert.equal(db.calls.length, 0)
  })

  it('validação antes do banco: configuração, bloqueio, exceção, feriado e id', async () => {
    const db = fakeDb()
    const cases: [Record<string, unknown>, string][] = [
      [{ action: 'save_settings', settings: { workingDays: [1], openMinute: 0, closeMinute: 1080, minNoticeMinutes: 0, windowDays: 30 } }, 'INVALID_SETTINGS'],
      [{ action: 'add_block', date: '2026-11-05', startTime: '14:00', endTime: '13:00' }, 'INVALID_BLOCK'],
      [{ action: 'add_block', date: '2026-11-05', category: 'feriado' }, 'INVALID_BLOCK'],
      [{ action: 'add_block', date: '2026-11-05', reason: 'x'.repeat(201) }, 'INVALID_BLOCK'],
      [{ action: 'add_exception', date: '2026-11-07' }, 'INVALID_EXCEPTION'],
      [{ action: 'set_holiday_rule', key: 'ponte', block: { type: 'full' } }, 'INVALID_HOLIDAY'],
      [{ action: 'set_holiday_rule', key: 'cinzas', block: { type: 'until', minute: 845 } }, 'INVALID_HOLIDAY'],
      [{ action: 'set_holiday_rule', key: 'cinzas', year: 1990, block: { type: 'full' } }, 'INVALID_HOLIDAY'],
      [{ action: 'revoke_block', id: "1' OR '1'='1" }, 'INVALID_ID'],
    ]
    for (const [data, error] of cases) {
      assert.deepEqual(await handleAvailabilityAction(db, { ...data, confirmed: true }, 'a'), { status: 400, body: { error } }, JSON.stringify(data))
    }
    assert.equal(db.calls.length, 0)
  })

  it('migração pendente: ações respondem 409 MIGRATION_PENDING; falha de banco = 503 sem detalhes', async () => {
    const pending = await handleAvailabilityAction(fakeDb(() => missingTable()), { action: 'add_block', date: '2026-11-04', confirmed: true }, 'a')
    assert.deepEqual(pending, { status: 409, body: { error: 'MIGRATION_PENDING' } })
    const failed = await handleAvailabilityAction(fakeDb(() => new Error('boom secret')), { action: 'add_block', date: '2026-11-04', confirmed: true }, 'a')
    assert.deepEqual(failed, { status: 503, body: { error: 'ACTION_FAILED' } })
  })

  it('bloqueio: grava autor e só CONTA reuniões existentes (nenhum UPDATE/DELETE em reservas ou reuniões)', async () => {
    const db = fakeDb(sql => sql.includes('INSERT') ? { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] } : { rows: [{ n: 2 }] })
    const r = await handleAvailabilityAction(db, { action: 'add_block', date: '2026-11-04', reason: 'Evento', confirmed: true }, 'crm_admin:abc')
    assert.deepEqual(r, { status: 200, body: { ok: true, id: '00000000-0000-4000-8000-000000000001', overlappingMeetings: 2 } })
    assert.ok(db.calls[0].params!.includes('crm_admin:abc'))
    for (const call of db.calls) {
      assert.ok(!/UPDATE|DELETE/i.test(call.sql) || !/booking_requests|appointments/.test(call.sql), call.sql)
    }
    assert.ok(/^\s*SELECT/i.test(db.calls[1].sql))
  })

  it('visão do painel: ano atual e seguinte, dias fechados com motivo, migração pendente sinalizada', () => {
    const view = availabilityOverview(DEFAULT_AVAILABILITY_RULES, new Date('2026-10-30T10:30:00-03:00'))
    assert.equal(view.migrationPending, true)
    assert.deepEqual([...new Set(view.holidays.map(h => h.date.slice(0, 4)))], ['2026', '2027'])
    const cinzas = view.holidays.find(h => h.key === 'cinzas' && h.date.startsWith('2027'))!
    assert.equal(cinzas.effect, 'Bloqueado até 14:00')
    const finados = view.window.closedDates.find(d => d.date === '2026-11-02')!
    assert.equal(finados.holidays[0].name, 'Finados')
  })
})

const LEGACY = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, minNoticeMinutes: 720, windowDays: 30 } }

describe('confirmação — validação no servidor (chamada direta à API)', () => {
  const session = { leadId: 'l', submissionId: 's', formSlug: 'odontologia' }
  function deps(rulesBlockDay: string | null) {
    const calls = { readBusy: 0, createEvent: 0, pool: 0 }
    const pool = { connect: async () => { calls.pool++; throw new Error('pool not expected') },
      query: async () => { calls.pool++; throw new Error('pool not expected') } }
    const value: ConfirmDeps = {
      pool: pool as never, verifySession: () => session, getForm: getBookingForm,
      readBusy: async () => { calls.readBusy++; return [] },
      createEvent: async () => { calls.createEvent++; return { id: 'evt', meetingUrl: null, htmlLink: null } },
      calendarId: 'cal', allowedEmail: 'x@exemplo.com',
      loadRules: async () => rulesBlockDay ? { ...LEGACY, blocks: [{
        id: 'b', startsAt: new Date(rulesBlockDay + 'T00:00:00-03:00').toISOString(),
        endsAt: new Date(rulesBlockDay + 'T23:59:00-03:00').toISOString(), category: 'day', reason: '' }] } : LEGACY,
    }
    return { calls, value }
  }
  function upcoming(weekday: number, minDays = 2): string {
    for (let d = minDays; d < minDays + 7; d++) {
      const day = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
      if (new Date(day + 'T12:00:00Z').getUTCDay() === weekday) return day
    }
    throw new Error('unreachable')
  }
  const ORIGIN = 'https://crm.cassiellos.com.br'

  it('horário bloqueado manualmente: 409 SLOT_UNAVAILABLE sem consultar banco de reservas nem Google', async () => {
    const day = upcoming(3) // quarta-feira
    const { calls, value } = deps(day)
    const r = await confirmBookingRequest(value, { bookingToken: 't', startAt: day + 'T13:00:00.000Z', pageOrigin: ORIGIN })
    assert.deepEqual(r, { status: 409, body: { error: 'SLOT_UNAVAILABLE' } })
    assert.deepEqual(calls, { readBusy: 0, createEvent: 0, pool: 0 })
  })

  it('D-D: conflitos de disponibilidade = 409 SLOT_UNAVAILABLE, sem banco de reservas e sem Google', async () => {
    const saturday = upcoming(6)
    const wednesday = upcoming(3)
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    for (const [label, startAt] of [
      ['sábado', saturday + 'T13:00:00.000Z'],
      ['domingo', upcoming(0) + 'T13:00:00.000Z'],
      ['fora do expediente (19:00)', wednesday + 'T22:00:00.000Z'],
      ['antes do expediente (08:00)', wednesday + 'T11:00:00.000Z'],
      ['data passada', day(-3) + 'T13:00:00.000Z'],
      ['além da janela de 30 dias', day(45) + 'T13:00:00.000Z'],
      ['dentro da antecedência de 12 h', new Date(Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000).toISOString()],
    ]) {
      const { calls, value } = deps(null)
      const r = await confirmBookingRequest(value, { bookingToken: 't', startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }, label)
      assert.deepEqual(calls, { readBusy: 0, createEvent: 0, pool: 0 }, label)
    }
  })

  it('D-D: pedido estruturalmente inválido = 400 INVALID_SLOT, sem banco e sem Google', async () => {
    const wednesday = upcoming(3)
    for (const [label, startAt] of [
      ['texto livre', 'amanhã às 10h'],
      ['sem fuso Z', wednesday + 'T13:00:00'],
      ['mês inexistente', '2026-13-10T13:00:00.000Z'],
      ['dia inexistente', '2026-02-30T13:00:00.000Z'],
      ['hora inexistente', wednesday + 'T25:00:00.000Z'],
      ['fora da grade (13:10)', wednesday + 'T13:10:00.000Z'],
      ['segundos (13:00:30)', wednesday + 'T13:00:30.000Z'],
      ['número', 1_800_000_000_000],
    ] as const) {
      const { calls, value } = deps(null)
      const r = await confirmBookingRequest(value, { bookingToken: 't', startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 400, body: { error: 'INVALID_SLOT' } }, label)
      assert.deepEqual(calls, { readBusy: 0, createEvent: 0, pool: 0 }, label)
    }
  })

  it('falha ao ler as regras: nenhuma reserva e nenhum evento (falha fechada)', async () => {
    const { calls, value } = deps(null)
    value.loadRules = async () => { throw new Error('db down') }
    const day = upcoming(3)
    const r = await confirmBookingRequest(value, { bookingToken: 't', startAt: day + 'T13:00:00.000Z', pageOrigin: ORIGIN })
    assert.ok(r.status >= 500, JSON.stringify(r))
    assert.deepEqual(calls, { readBusy: 0, createEvent: 0, pool: 0 })
  })

  it('12. padrão 3 h / 3 dias na API: hoje + 4 e menos de 3 h recusados (409) sem banco e sem Google', async () => {
    const day4 = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10)
    const soon = new Date(Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000).toISOString()
    for (const startAt of [day4 + 'T13:00:00.000Z', soon]) {
      const { calls, value } = deps(null)
      value.loadRules = async () => DEFAULT_AVAILABILITY_RULES
      const r = await confirmBookingRequest(value, { bookingToken: 't', startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }, startAt)
      assert.deepEqual(calls, { readBusy: 0, createEvent: 0, pool: 0 })
    }
  })
})
