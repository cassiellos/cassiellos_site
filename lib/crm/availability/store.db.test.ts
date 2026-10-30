/**
 * Módulo de disponibilidade — integração contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL, migrações 0001–0008). Nunca usar o Neon.
 * Google é simulado: contamos cada chamada.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleAvailabilityAction } from './admin'
import { DEFAULT_AVAILABILITY_SETTINGS, listAvailableSlots } from './engine'
import { loadAvailabilityRules } from './store'
import { confirmBookingRequest, type ConfirmDeps } from '../booking-confirmation'
import { getBookingForm } from '../booking-forms'
import { finalizeBookingReservation, reserveBookingSlot } from '../booking-reservation'
import { saveLeadSubmission } from '../lead-intake'
import { TURNSTILE_BOOKING_ACTION } from '../turnstile'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const MIGRATION = readFileSync(join(process.cwd(), 'db/migrations/0008_availability.sql'), 'utf8')
const ACTOR = 'crm_admin:teste0008'
const DAY = 86_400_000

function upcoming(weekday: number, minDays = 3): string {
  for (let d = minDays; d < minDays + 7; d++) {
    const day = new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
    if (new Date(day + 'T12:00:00Z').getUTCDay() === weekday) return day
  }
  throw new Error('unreachable')
}

describe('disponibilidade — migração 0008 e painel (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 4 }) })
  after(async () => {
    // Restaura o padrão para não afetar outras execuções.
    await pool.query('DELETE FROM crm.holiday_rules')
    await pool.query("UPDATE crm.availability_blocks SET revoked_at = now(), revoked_by = 'teardown' WHERE revoked_at IS NULL")
    await pool.query("UPDATE crm.availability_exceptions SET revoked_at = now(), revoked_by = 'teardown' WHERE revoked_at IS NULL")
    await pool.query(`UPDATE crm.availability_settings SET working_days = '{1,2,3,4,5}', open_minute = 540, close_minute = 1080,
      min_notice_minutes = 720, window_days = 30 WHERE id = 1`)
    await pool?.end()
  })
  const act = (data: Record<string, unknown>) => handleAvailabilityAction(pool, { ...data, confirmed: true }, ACTOR)

  it('migração aplicada: configuração inicial D3 (seg–sex, 09–18h, 30 min, 12 h, 30 dias)', async () => {
    const rules = await loadAvailabilityRules(pool)
    assert.equal(rules.source, 'database')
    assert.deepEqual(rules.settings, DEFAULT_AVAILABILITY_SETTINGS)
  })

  it('0008 é reexecutável e não destrutiva (dados existentes preservados)', async () => {
    const saved = await act({ action: 'save_settings', settings: { ...DEFAULT_AVAILABILITY_SETTINGS, windowDays: 45 } })
    assert.equal(saved.status, 200)
    await pool.query(MIGRATION)
    await pool.query(MIGRATION)
    const rows = (await pool.query('SELECT window_days, updated_by FROM crm.availability_settings')).rows
    assert.deepEqual(rows, [{ window_days: 45, updated_by: ACTOR }])
    assert.equal((await act({ action: 'save_settings', settings: DEFAULT_AVAILABILITY_SETTINGS })).status, 200)
  })

  it('restrições do banco recusam valores fora dos limites mesmo por SQL direto', async () => {
    for (const sql of [
      'UPDATE crm.availability_settings SET open_minute = 300 WHERE id = 1',
      'UPDATE crm.availability_settings SET close_minute = 1350 WHERE id = 1',
      'UPDATE crm.availability_settings SET window_days = 120 WHERE id = 1',
      "UPDATE crm.availability_settings SET working_days = '{}' WHERE id = 1",
      'INSERT INTO crm.availability_settings (id) VALUES (2)',
      "INSERT INTO crm.availability_blocks (starts_at, ends_at, category) VALUES (now(), now() - interval '1 hour', 'day')",
      "INSERT INTO crm.availability_blocks (starts_at, ends_at, category) VALUES (now(), now() + interval '1 hour', 'feriado')",
      "INSERT INTO crm.availability_exceptions (starts_at, ends_at) VALUES (now(), now() + interval '2 days')",
      "INSERT INTO crm.holiday_rules (rule_key, block_type, block_minute) VALUES ('cinzas', 'until', 845)",
      "INSERT INTO crm.holiday_rules (rule_key, block_type) VALUES ('cinzas', 'after')",
    ]) await assert.rejects(pool.query(sql), (e: { code?: string }) => e.code === '23514', sql)
  })

  it('configuração salva pelo painel passa a valer na leitura', async () => {
    const custom = { workingDays: [1, 2, 3, 4, 5, 6], openMinute: 480, closeMinute: 720, minNoticeMinutes: 1440, windowDays: 14 }
    assert.equal((await act({ action: 'save_settings', settings: custom })).status, 200)
    assert.deepEqual((await loadAvailabilityRules(pool)).settings, { ...custom, slotMinutes: 30 })
    assert.equal((await act({ action: 'save_settings', settings: DEFAULT_AVAILABILITY_SETTINGS })).status, 200)
  })

  it('bloqueio sobre reunião confirmada: reunião e reserva permanecem INTACTAS; apenas aviso com a contagem', async () => {
    const address = 'disp.' + randomUUID().slice(0, 8) + '@exemplo.com'
    const lead = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Lead Disponibilidade', email: address,
      phone: '31900000040', formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Disp', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: true, bookingMode: 'test',
      protection: { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    const startAt = '2031-03-05T13:00:00.000Z' // quarta-feira, 10:00 local (data exclusiva deste teste)
    const endAt = '2031-03-05T13:30:00.000Z'
    const cal = 'cal-' + randomUUID()
    const reserved = await reserveBookingSlot(pool, { leadId: lead.leadId, submissionId: lead.submissionId, formSlug: 'odontologia',
      startAt, endAt, calendarId: cal, allowedEmail: address })
    assert.equal(reserved.status, 'reserved')
    const bookingId = (reserved as { id: string }).id
    const { appointmentId } = await finalizeBookingReservation(pool, {
      bookingId, leadId: lead.leadId, submissionId: lead.submissionId, eventId: 'evt' + randomUUID().replaceAll('-', ''),
      meetingUrl: null, startAt, endAt, calendarId: cal, formSlug: 'odontologia', pageOrigin: 'https://crm.cassiellos.com.br',
    })
    const snapshot = async () => ({
      booking: (await pool.query('SELECT status, starts_at, ends_at, google_event_id, updated_at FROM crm.booking_requests WHERE id = $1', [bookingId])).rows[0],
      appointment: (await pool.query('SELECT status, starts_at, ends_at, calendar_event_id, cancelled_at, updated_at FROM crm.appointments WHERE id = $1', [appointmentId])).rows[0],
    })
    const before = await snapshot()
    assert.equal(before.booking.status, 'confirmed')
    const r = await act({ action: 'add_block', date: '2031-03-05', reason: 'Evento interno', category: 'day' })
    assert.equal(r.status, 200)
    assert.equal(r.body.overlappingMeetings, 1)
    assert.deepEqual(await snapshot(), before)
    const revoke = await act({ action: 'revoke_block', id: r.body.id })
    assert.equal(revoke.status, 200)
    assert.deepEqual(await snapshot(), before)
  })

  it('bloqueio, exceção e revogação refletem na leitura; revogação mantém histórico', async () => {
    const day = upcoming(3) // próxima quarta-feira
    const block = await act({ action: 'add_block', date: day, startTime: '12:00', endTime: '14:00', reason: 'Almoço' })
    const saturday = upcoming(6)
    const exception = await act({ action: 'add_exception', date: saturday, startTime: '09:00', endTime: '11:00', reason: 'Plantão' })
    assert.equal(block.status, 200); assert.equal(exception.status, 200)
    const rules = await loadAvailabilityRules(pool)
    const wed = listAvailableSlots(day, [], rules).map(s => s.localTime)
    assert.ok(!wed.includes('12:00') && !wed.includes('13:30') && wed.includes('14:00'))
    assert.deepEqual(listAvailableSlots(saturday, [], rules).map(s => s.localTime), ['09:00', '09:30', '10:00', '10:30'])
    assert.equal((await act({ action: 'revoke_block', id: block.body.id })).status, 200)
    assert.deepEqual(await act({ action: 'revoke_block', id: block.body.id }), { status: 404, body: { error: 'NOT_FOUND' } })
    assert.equal((await act({ action: 'revoke_exception', id: exception.body.id })).status, 200)
    const after = await loadAvailabilityRules(pool)
    assert.equal(after.blocks.some(b => b.id === block.body.id), false)
    assert.equal(after.exceptions.some(e => e.id === exception.body.id), false)
    const kept = (await pool.query('SELECT revoked_by, created_by FROM crm.availability_blocks WHERE id = $1', [block.body.id])).rows[0]
    assert.deepEqual(kept, { revoked_by: ACTOR, created_by: ACTOR })
  })

  it('ajuste de feriado: ano específico, todos os anos e restauração do padrão', async () => {
    assert.equal((await act({ action: 'set_holiday_rule', key: 'corpus_christi', year: null, block: { type: 'none' } })).status, 200)
    assert.equal((await act({ action: 'set_holiday_rule', key: 'corpus_christi', year: 2027, block: { type: 'after', minute: 780 } })).status, 200)
    assert.equal((await act({ action: 'set_holiday_rule', key: 'corpus_christi', year: 2027, block: { type: 'until', minute: 720 } })).status, 200)
    let rules = await loadAvailabilityRules(pool)
    assert.equal(rules.holidayOverrides.length, 2)
    assert.deepEqual(rules.holidayOverrides.find(o => o.year === 2027)!.block, { type: 'until', minute: 720 })
    assert.equal((await act({ action: 'set_holiday_rule', key: 'corpus_christi', year: 2027, block: null })).status, 200)
    assert.equal((await act({ action: 'set_holiday_rule', key: 'corpus_christi', year: null, block: null })).status, 200)
    rules = await loadAvailabilityRules(pool)
    assert.equal(rules.holidayOverrides.length, 0)
  })

  it('confirmação direta à API respeita o bloqueio do banco: 409 e nenhuma chamada ao Google', async () => {
    const day = upcoming(4) // próxima quinta-feira
    const block = await act({ action: 'add_block', date: day, reason: 'Bloqueio de teste' })
    assert.equal(block.status, 200)
    const calls = { readBusy: 0, createEvent: 0 }
    const deps: ConfirmDeps = {
      pool, verifySession: () => ({ leadId: randomUUID(), submissionId: randomUUID(), formSlug: 'odontologia' }),
      getForm: getBookingForm, calendarId: 'cal-' + randomUUID(), allowedEmail: 'x@exemplo.com',
      readBusy: async () => { calls.readBusy++; return [] },
      createEvent: async () => { calls.createEvent++; return { id: 'evt', meetingUrl: null, htmlLink: null } },
      loadRules: () => loadAvailabilityRules(pool),
    }
    const r = await confirmBookingRequest(deps, { bookingToken: 't', startAt: day + 'T13:00:00.000Z', pageOrigin: 'https://crm.cassiellos.com.br' })
    assert.deepEqual(r, { status: 409, body: { error: 'SLOT_UNAVAILABLE' } })
    assert.deepEqual(calls, { readBusy: 0, createEvent: 0 })
    assert.equal((await act({ action: 'revoke_block', id: block.body.id })).status, 200)
  })
})
