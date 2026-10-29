/**
 * Teste de integração das regras de reagendamento contra um PostgreSQL DESCARTÁVEL.
 * Só roda quando CRM_INTEGRATION_DATABASE_URL aponta para um banco com as migrações
 * 0001–0007 aplicadas (ex.: instância local criada só para o teste). Nunca usar o Neon.
 * Nenhuma chamada ao Google: o evento é simulado por um id fictício.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { saveLeadSubmission } from './lead-intake'
import {
  finalizeBookingReservation, releaseReservationBeforeGoogle, reserveBookingSlot,
  type ConnectablePool, type ReserveInput,
} from './booking-reservation'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

const MINUTE = 60_000
const HOUR = 60 * MINUTE

type Slot = { startAt: string; endAt: string }
type Lead = { leadId: string; submissionId: string; email: string }

function slotFrom(startMs: number, minutes = 30): Slot {
  return { startAt: new Date(startMs).toISOString(), endAt: new Date(startMs + minutes * MINUTE).toISOString() }
}
/** Slot alinhado a 30 min, deslocado em horas a partir de agora (negativo = passado). */
function slotIn(hours: number): Slot {
  const aligned = Math.floor((Date.now() + hours * HOUR) / (30 * MINUTE)) * 30 * MINUTE
  return slotFrom(aligned)
}
function email(tag: string): string { return tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com' }

describe('reserveBookingSlot — regras de reagendamento (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 12 }) })
  after(async () => { await pool?.end() })

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows

  async function submit(address: string, isTest = true, db: ConnectablePool = pool): Promise<Lead> {
    const r = await saveLeadSubmission(db, {
      idempotencyKey: randomUUID(), name: 'Lead Reagendamento', email: address, phone: '31900000020',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Reagenda', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: isTest, bookingMode: isTest ? 'test' : 'live',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    return { leadId: r.leadId, submissionId: r.submissionId, email: address }
  }

  function reserveInput(lead: Lead, slot: Slot, calendarId: string, extra: Partial<ReserveInput> = {}): ReserveInput {
    return { leadId: lead.leadId, submissionId: lead.submissionId, formSlug: 'odontologia',
      startAt: slot.startAt, endAt: slot.endAt, calendarId, allowedEmail: lead.email, ...extra }
  }

  /** Fluxo completo sem Google: reserva + confirmação com evento fictício. */
  async function book(lead: Lead, slot: Slot, calendarId: string, db: ConnectablePool = pool) {
    const r = await reserveBookingSlot(db, reserveInput(lead, slot, calendarId))
    assert.equal(r.status, 'reserved')
    const bookingId = (r as { id: string }).id
    const { appointmentId } = await finalizeBookingReservation(db, {
      bookingId, leadId: lead.leadId, submissionId: lead.submissionId,
      eventId: 'evt' + randomUUID().replaceAll('-', ''), meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      startAt: slot.startAt, endAt: slot.endAt, calendarId, formSlug: 'odontologia',
      pageOrigin: 'https://crm.cassiellos.com.br',
    })
    return { bookingId, appointmentId }
  }

  async function setStatus(appointmentId: string, status: string) {
    const stamp = status === 'completed' ? ', completed_at = now()' : status === 'cancelled' ? ', cancelled_at = now()' : ''
    await pool.query('UPDATE crm.appointments SET status = $2' + stamp + ' WHERE id = $1', [appointmentId, status])
  }

  const calendar = () => 'cal-' + randomUUID()

  it('sem reunião anterior: reserva normalmente', async () => {
    const lead = await submit(email('sem.reuniao'))
    const r = await reserveBookingSlot(pool, reserveInput(lead, slotIn(48), calendar()))
    assert.equal(r.status, 'reserved')
  })

  it('reunião confirmada futura bloqueia, com resposta genérica e sem criar registro', async () => {
    const address = email('futura')
    const first = await submit(address)
    const cal = calendar()
    await book(first, slotIn(48), cal)
    const again = await submit(address)
    const r = await reserveBookingSlot(pool, reserveInput(again, slotIn(72), cal))
    assert.deepEqual(r, { status: 'active_meeting' }, 'sem data, horário, link ou ids na resposta')
    assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [first.leadId])).length, 1)
  })

  it('reunião em andamento (começou e ainda não terminou) bloqueia', async () => {
    const address = email('andamento')
    const first = await submit(address)
    const cal = calendar()
    await book(first, slotFrom(Date.now() - 10 * MINUTE), cal)
    const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(48), cal))
    assert.equal(r.status, 'active_meeting')
  })

  it('reunião "confirmed" que já terminou NÃO bloqueia (status sozinho não prende o contato)', async () => {
    const address = email('passada')
    const first = await submit(address)
    const cal = calendar()
    const old = await book(first, slotIn(-48), cal)
    const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(48), cal))
    assert.equal(r.status, 'reserved')
    const [prev] = await q<{ status: string }>('SELECT status FROM crm.appointments WHERE id = $1', [old.appointmentId])
    assert.equal(prev.status, 'confirmed', 'reunião anterior não é alterada')
  })

  for (const [status, hours] of [['completed', -48], ['no_show', -48], ['cancelled', 48], ['rescheduled', 48]] as const) {
    it('reunião "' + status + '" libera novo agendamento', async () => {
      const address = email(status.replace('_', '-'))
      const first = await submit(address)
      const cal = calendar()
      const old = await book(first, slotIn(hours), cal)
      await setStatus(old.appointmentId, status)
      const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(96), cal))
      assert.equal(r.status, 'reserved')
    })
  }

  it('reunião "pending" futura também bloqueia', async () => {
    const address = email('pending')
    const lead = await submit(address)
    const slot = slotIn(48)
    await pool.query(`INSERT INTO crm.appointments (lead_id, calendar_id, starts_at, ends_at, status)
      VALUES ($1, $2, $3, $4, 'pending')`, [lead.leadId, calendar(), slot.startAt, slot.endAt])
    const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(72), calendar()))
    assert.equal(r.status, 'active_meeting')
  })

  it('reserva em processamento (outro envio) bloqueia com a mesma resposta genérica', async () => {
    const address = email('processando')
    const first = await submit(address)
    const cal = calendar()
    const r1 = await reserveBookingSlot(pool, reserveInput(first, slotIn(48), cal))
    assert.equal(r1.status, 'reserved')
    const r2 = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(72), cal))
    assert.deepEqual(r2, { status: 'active_meeting' })
  })

  it('reserva "processing" cujo horário já terminou não prende o contato para sempre', async () => {
    const address = email('processando.antiga')
    const first = await submit(address)
    const cal = calendar()
    const stuck = await reserveBookingSlot(pool, reserveInput(first, slotIn(-48), cal))
    assert.equal(stuck.status, 'reserved')
    const r = await reserveBookingSlot(pool, reserveInput(await submit(address), slotIn(48), cal))
    assert.equal(r.status, 'reserved')
    const [old] = await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [(stuck as { id: string }).id])
    assert.equal(old.status, 'processing', 'reserva antiga continua para reconciliação manual')
  })

  it('reserva liberada antes do Google (failed) permite novo agendamento', async () => {
    const address = email('liberada')
    const first = await submit(address)
    const cal = calendar()
    const slot = slotIn(48)
    const r1 = await reserveBookingSlot(pool, reserveInput(first, slot, cal))
    await releaseReservationBeforeGoogle(pool, (r1 as { id: string }).id, 'EXTERNAL_CALENDAR_CONFLICT')
    const r2 = await reserveBookingSlot(pool, reserveInput(await submit(address), slot, cal))
    assert.equal(r2.status, 'reserved', 'inclusive o mesmo horário, que ficou livre')
  })

  it('mesmo envio repetido é idempotente (processing → confirmed), nunca 2ª reserva', async () => {
    const lead = await submit(email('idempotente'))
    const cal = calendar()
    const slot = slotIn(48)
    const r1 = await reserveBookingSlot(pool, reserveInput(lead, slot, cal))
    const r2 = await reserveBookingSlot(pool, reserveInput(lead, slotIn(72), cal))
    assert.equal(r2.status, 'already_processing')
    await finalizeBookingReservation(pool, {
      bookingId: (r1 as { id: string }).id, leadId: lead.leadId, submissionId: lead.submissionId,
      eventId: 'evt' + randomUUID().replaceAll('-', ''), meetingUrl: null, startAt: slot.startAt, endAt: slot.endAt,
      calendarId: cal, formSlug: 'odontologia', pageOrigin: 'https://crm.cassiellos.com.br',
    })
    const r3 = await reserveBookingSlot(pool, reserveInput(lead, slotIn(96), cal))
    assert.deepEqual(r3, { status: 'already_confirmed', id: (r1 as { id: string }).id })
    assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [lead.leadId])).length, 1)
  })

  it('confirmações simultâneas do mesmo lead (envios diferentes): apenas 1 reserva', async () => {
    const address = email('simultaneo')
    const leads: Lead[] = []
    for (let i = 0; i < 6; i++) leads.push(await submit(address))
    const cal = calendar()
    const results = await Promise.all(leads.map((lead, i) =>
      reserveBookingSlot(pool, reserveInput(lead, slotIn(48 + i), cal))))
    assert.equal(results.filter(r => r.status === 'reserved').length, 1)
    assert.equal(results.filter(r => r.status === 'active_meeting').length, 5)
    const rows = await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE lead_id = $1', [leads[0].leadId])
    assert.deepEqual(rows.map(r => r.status), ['processing'])
  })

  it('mesmo horário disputado por dois leads ao mesmo tempo: um reserva, outro slot_unavailable', async () => {
    const cal = calendar()
    const slot = slotIn(48)
    const a = await submit(email('disputa.a'))
    const b = await submit(email('disputa.b'))
    const results = await Promise.all([a, b].map(lead => reserveBookingSlot(pool, reserveInput(lead, slot, cal))))
    assert.deepEqual(results.map(r => r.status).sort(), ['reserved', 'slot_unavailable'])
  })

  it('horário já ocupado por reunião confirmada de outro lead continua indisponível', async () => {
    const cal = calendar()
    const slot = slotIn(48)
    await book(await submit(email('ocupado.a')), slot, cal)
    const r = await reserveBookingSlot(pool, reserveInput(await submit(email('ocupado.b')), slot, cal))
    assert.equal(r.status, 'slot_unavailable')
  })

  it('leads diferentes não se bloqueiam', async () => {
    const cal = calendar()
    await book(await submit(email('independente.a')), slotIn(48), cal)
    const r = await reserveBookingSlot(pool, reserveInput(await submit(email('independente.b')), slotIn(49), cal))
    assert.equal(r.status, 'reserved')
  })

  it('allowlist e envio inválido continuam valendo antes da regra de reagendamento', async () => {
    const lead = await submit(email('allowlist'))
    const cal = calendar()
    assert.equal((await reserveBookingSlot(pool, reserveInput(lead, slotIn(48), cal,
      { allowedEmail: 'outro@exemplo.com' }))).status, 'email_not_allowed')
    assert.equal((await reserveBookingSlot(pool, reserveInput(lead, slotIn(48), cal,
      { formSlug: 'outro-form' }))).status, 'bad_submission')
    assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [lead.leadId])).length, 0)
  })

  it('reagendamento preserva todos os registros anteriores e cria registros próprios', async () => {
    const address = email('historico')
    const first = await submit(address, false)
    const cal = calendar()
    const old = await book(first, slotIn(-48), cal)
    await setStatus(old.appointmentId, 'completed')
    await pool.query(`INSERT INTO crm.deals (lead_id, appointment_id, status, amount, closed_at, is_test)
      VALUES ($1, $2, 'won', 1500, now(), false)`, [first.leadId, old.appointmentId])
    await pool.query("UPDATE crm.leads SET stage = 'customer' WHERE id = $1", [first.leadId])
    const snapshot = async () => ({
      appointment: await q('SELECT * FROM crm.appointments WHERE id = $1', [old.appointmentId]),
      booking: await q('SELECT * FROM crm.booking_requests WHERE id = $1', [old.bookingId]),
      deals: await q('SELECT * FROM crm.deals WHERE lead_id = $1', [first.leadId]),
      lead: await q('SELECT full_name, email, whatsapp, company, segment, stage, is_test FROM crm.leads WHERE id = $1', [first.leadId]),
      oldActivities: await q('SELECT * FROM crm.lead_activities WHERE appointment_id = $1', [old.appointmentId]),
      oldTracking: await q('SELECT * FROM crm.tracking_events WHERE appointment_id = $1', [old.appointmentId]),
    })
    const before = await snapshot()

    const second = await submit(address)
    const fresh = await book(second, slotIn(48), cal)
    assert.notEqual(fresh.appointmentId, old.appointmentId)
    assert.deepEqual(await snapshot(), before, 'nada anterior foi alterado ou apagado')
    assert.equal((await q('SELECT 1 FROM crm.leads WHERE lower(email) = $1', [address])).length, 1)
    const appts = await q<{ status: string }>('SELECT status FROM crm.appointments WHERE lead_id = $1 ORDER BY starts_at', [first.leadId])
    assert.deepEqual(appts.map(a => a.status), ['completed', 'confirmed'])
    assert.equal((await q('SELECT 1 FROM crm.booking_requests WHERE lead_id = $1', [first.leadId])).length, 2)
    assert.equal((await q("SELECT 1 FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'meeting_scheduled'", [first.leadId])).length, 2)
    assert.equal((await q("SELECT 1 FROM crm.tracking_events WHERE lead_id = $1 AND event_name = 'Chronos_Scheduled'", [first.leadId])).length, 2)
  })

  it('novo agendamento herda a classificação real/teste do lead (não do envio)', async () => {
    for (const isTest of [false, true]) {
      const address = email(isTest ? 'classe.teste' : 'classe.real')
      const lead = await submit(address, isTest)
      // O reenvio pede "teste" mas o lead existente mantém a classificação original.
      const again = await submit(address, true)
      const cal = calendar()
      const old = await book(lead, slotIn(-48), cal)
      await setStatus(old.appointmentId, 'completed')
      const fresh = await book(again, slotIn(48), cal)
      const [appt] = await q<{ is_test: boolean }>('SELECT is_test FROM crm.appointments WHERE id = $1', [fresh.appointmentId])
      assert.equal(appt.is_test, isTest)
      const [ev] = await q<{ metadata: Record<string, unknown> }>('SELECT metadata FROM crm.tracking_events WHERE appointment_id = $1', [fresh.appointmentId])
      assert.equal(ev.metadata.isTest, isTest)
      const [act] = await q<{ details: Record<string, unknown> }>("SELECT details FROM crm.lead_activities WHERE appointment_id = $1 AND activity_kind = 'meeting_scheduled'", [fresh.appointmentId])
      assert.equal(act.details.isTest, isTest)
    }
  })

  it('limites exatos de horário: término == agora libera; 1 ms antes bloqueia; início == agora bloqueia', async () => {
    const address = email('limite')
    const lead = await submit(address)
    const cal = calendar()
    // Reunião às 09:00–09:30 de Brasília (12:00–12:30 UTC).
    const meeting = { startAt: '2026-11-02T09:00:00-03:00', endAt: '2026-11-02T09:30:00-03:00' }
    await book(lead, meeting, cal)
    const other = slotIn(24 * 10)
    const at = (iso: string) => ({ now: new Date(iso) })
    assert.equal((await reserveBookingSlot(pool, reserveInput(await submit(address), other, cal, at('2026-11-02T12:00:00.000Z')))).status, 'active_meeting')
    assert.equal((await reserveBookingSlot(pool, reserveInput(await submit(address), other, cal, at('2026-11-02T12:29:59.999Z')))).status, 'active_meeting')
    assert.equal((await reserveBookingSlot(pool, reserveInput(await submit(address), other, cal, at('2026-11-02T12:30:00.000Z')))).status, 'reserved')
  })

  for (const timeZone of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
    it('fuso da sessão do banco não altera a decisão (' + timeZone + ')', async () => {
      const tzPool = new Pool({ connectionString: url, max: 3, options: '-c TimeZone=' + timeZone })
      try {
        const [{ tz }] = (await tzPool.query<{ tz: string }>("SELECT current_setting('TimeZone') AS tz")).rows
        assert.equal(tz, timeZone)
        const address = email('fuso')
        const lead = await submit(address, true, tzPool)
        const cal = calendar()
        // 21:30–22:00 em Brasília = 00:30–01:00 UTC do DIA SEGUINTE (virada de data).
        const meeting = { startAt: '2026-11-02T21:30:00-03:00', endAt: '2026-11-02T22:00:00-03:00' }
        const { appointmentId } = await book(lead, meeting, cal, tzPool)
        const [row] = (await tzPool.query<{ starts_at: Date; ends_at: Date }>(
          'SELECT starts_at, ends_at FROM crm.appointments WHERE id = $1', [appointmentId])).rows
        assert.equal(row.starts_at.toISOString(), '2026-11-03T00:30:00.000Z')
        assert.equal(row.ends_at.toISOString(), '2026-11-03T01:00:00.000Z')
        const other = slotIn(24 * 12)
        const at = (iso: string) => ({ now: new Date(iso) })
        assert.equal((await reserveBookingSlot(tzPool, reserveInput(await submit(address, true, tzPool), other, cal,
          at('2026-11-02T21:59:59-03:00')))).status, 'active_meeting')
        assert.equal((await reserveBookingSlot(tzPool, reserveInput(await submit(address, true, tzPool), other, cal,
          at('2026-11-03T01:00:00Z')))).status, 'reserved')
      } finally {
        await tzPool.end()
      }
    })
  }
})
