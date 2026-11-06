import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bookingEventDescription, bookingEventTitle, buildBookingEventRequest, isGoogleMeetUrl, isInvitableEmail, parseCreatedEvent,
} from './booking-event'
import { cancelGoogleEvent, insertBookingEvent } from './google-event-ops'

// 03/11/2026 09:00–09:30 em Brasília (UTC−3). Endereços fictícios.
const INPUT = {
  title: 'Agência Cassiellos | Reunião confirmada — 03/11 às 09h', startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T12:30:00.000Z',
  requestId: '6f1d2c3b-1111-4222-8333-444455556666', googleEventId: 'c6f1d2c3b111142228333444455556666', reference: '6f1d2c3b',
}
const LEAD = 'maria+agenda@gmail.com'

describe('evento do agendamento público — convite ao lead', () => {
  it('com e-mail do lead: único participante e sendUpdates=all (o Google envia o convite)', () => {
    const { path, body } = buildBookingEventRequest('primary', { ...INPUT, attendeeEmail: ' Maria+Agenda@Gmail.com ' })
    assert.equal(path, 'calendars/primary/events?sendUpdates=all&conferenceDataVersion=1')
    assert.deepEqual(body.attendees, [{ email: LEAD }])
    assert.equal(body.guestsCanInviteOthers, false)
    assert.equal(body.guestsCanSeeOtherGuests, false)
    assert.equal(body.guestsCanModify, false)
  })

  it('convite: descrição curta em português, data e horário de Brasília, duração; sem dados internos nem pessoais', () => {
    const { body } = buildBookingEventRequest('primary', { ...INPUT, attendeeEmail: LEAD })
    const d = String(body.description)
    assert.equal(body.summary, INPUT.title)
    assert.equal(d, [
      'Reunião confirmada com a Agência Cassiellos.',
      '',
      'Data: terça-feira, 03/11/2026',
      'Horário: 09h às 09h30 — Brasília',
      'Duração: 30 minutos',
      '',
      'Acesse a reunião pelo link do Google Meet disponível neste convite.',
    ].join('\n'))
    assert.doesNotMatch(d, /Referência|WhatsApp|Test Event|Invitation|\b(the|meeting|event)\b/i, 'sem dado interno nem inglês')
    // o e-mail aparece só como participante; nada mais do visitante vai ao Google
    assert.equal(JSON.stringify({ ...body, attendees: undefined }).includes('@'), false)
    assert.deepEqual(Object.keys(body.start as object), ['dateTime', 'timeZone'])
    assert.deepEqual(body.start, { dateTime: INPUT.startAt, timeZone: 'America/Sao_Paulo' })
  })

  it('sem e-mail (convite desligado): comportamento anterior — sem attendees e sendUpdates=none', () => {
    for (const attendeeEmail of [undefined, null, '', '   ']) {
      const { path, body } = buildBookingEventRequest('primary', { ...INPUT, attendeeEmail })
      assert.equal(path, 'calendars/primary/events?sendUpdates=none&conferenceDataVersion=1')
      assert.equal('attendees' in body, false)
      assert.doesNotMatch(JSON.stringify(body), /@|attendee|mailto/i)
    }
  })

  it('e-mail malformado nunca vai ao Google', () => {
    for (const bad of ['maria', 'a@b', 'x@y.c', 'a b@c.com', '"x"@y.com', 'a@b.com,c@d.com', 'a@b.com>']) {
      assert.throws(() => buildBookingEventRequest('primary', { ...INPUT, attendeeEmail: bad }), /ATTENDEE_INVALID/, bad)
    }
    for (const ok of [LEAD, 'joao_99@outlook.com', 'dra.ana@odonto.saude.com.br']) assert.equal(isInvitableEmail(ok), true, ok)
  })

  it('Google Meet preservado: UM evento com id fixo e conferenceData hangoutsMeet idempotente', () => {
    const { body } = buildBookingEventRequest('primary', { ...INPUT, attendeeEmail: LEAD })
    assert.deepEqual(body.conferenceData, { createRequest: { requestId: INPUT.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } })
    assert.equal(body.id, INPUT.googleEventId)
  })

  it('título: "Agência Cassiellos | Reunião confirmada — DD/MM às HHh", data e hora reais em Brasília', () => {
    assert.equal(bookingEventTitle('2026-11-06T12:00:00.000Z'), 'Agência Cassiellos | Reunião confirmada — 06/11 às 09h')
    assert.equal(bookingEventTitle('2026-11-06T17:30:00.000Z'), 'Agência Cassiellos | Reunião confirmada — 06/11 às 14h30')
    // fuso de Brasília (UTC−3): 01h UTC do dia 07 ainda é dia 06 em Brasília
    assert.equal(bookingEventTitle('2026-11-07T01:05:00.000Z'), 'Agência Cassiellos | Reunião confirmada — 06/11 às 22h05')
    assert.equal(bookingEventTitle('2027-01-01T02:59:00.000Z'), 'Agência Cassiellos | Reunião confirmada — 31/12 às 23h59')
    assert.throws(() => bookingEventTitle('não é data'), /TIME_INVALID/)
  })

  it('título curto e legível: marca e data/hora nos primeiros caracteres, sem inglês', () => {
    const t = bookingEventTitle('2026-11-06T12:00:00.000Z')
    assert.ok(t.length <= 60, String(t.length))
    assert.ok(t.startsWith('Agência Cassiellos | Reunião confirmada'))
    assert.doesNotMatch(t, /Test|Event|Invitation|Meeting/i)
  })

  it('evento SEM convidado (interno) mantém a referência para conciliação', () => {
    const d = bookingEventDescription({ reference: '6f1d2c3b', startAt: INPUT.startAt, endAt: INPUT.endAt, invited: false })
    assert.match(d, /Referência do agendamento: 6f1d2c3b$/)
    assert.match(d, /^Reunião confirmada com a Agência Cassiellos\./)
  })

  it('descrição recusa referência que não seja interna e horários inválidos', () => {
    for (const reference of ['maria@exemplo.com', 'Maria Silva', '31 99999-0000']) {
      assert.throws(() => bookingEventDescription({ reference, startAt: INPUT.startAt, endAt: INPUT.endAt, invited: true }), /REFERENCE_INVALID/)
    }
    assert.throws(() => bookingEventDescription({ reference: 'abcd1234', startAt: INPUT.endAt, endAt: INPUT.startAt, invited: true }), /TIME_INVALID/)
  })

  it('id da agenda é codificado no caminho', () => {
    assert.equal(buildBookingEventRequest('a/b?c', INPUT).path.startsWith('calendars/a%2Fb%3Fc/events?'), true)
  })

  it('resposta do Google: Meet só de meet.google.com; convite "pedido" só se o Google devolveu o participante', () => {
    assert.deepEqual(parseCreatedEvent({ id: 'evt1', hangoutLink: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://www.google.com/calendar/event?eid=x',
      attendees: [{ email: LEAD, responseStatus: 'needsAction' }] }, LEAD),
    { id: 'evt1', meetingUrl: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://www.google.com/calendar/event?eid=x', invitationRequested: true })
    assert.equal(parseCreatedEvent({ id: 'evt1b' }, LEAD).invitationRequested, false, 'sem participante na resposta = não afirmar convite')
    assert.equal(parseCreatedEvent({ id: 'evt1c', attendees: [{ email: LEAD }] }).invitationRequested, false, 'convite desligado')
    assert.equal(parseCreatedEvent({ id: 'evt2' }).meetingUrl, null) // Meet ainda pendente
    assert.equal(parseCreatedEvent({ id: 'evt3', hangoutLink: 'javascript:alert(1)' }).meetingUrl, null)
    assert.equal(parseCreatedEvent({ id: 'evt4', hangoutLink: 'https://meet.google.com.evil.example/abc' }).meetingUrl, null)
    for (const bad of [null, {}, { id: '' }, { id: 42 }, 'ok', { error: { code: 403 } }]) {
      assert.throws(() => parseCreatedEvent(bad), /CRM_GOOGLE_EVENT_UNCONFIRMED/)
    }
  })

  it('validação do link do Meet', () => {
    assert.equal(isGoogleMeetUrl('https://meet.google.com/abc-defg-hij'), true)
    assert.equal(isGoogleMeetUrl('http://meet.google.com/abc-defg-hij'), false)
    assert.equal(isGoogleMeetUrl(null), false)
  })

  it('cancelamento: DELETE do MESMO evento com sendUpdates=all (o Google avisa o participante); 404/410 tratados', async () => {
    const calls: string[] = []
    const request = (status: number) => async (method: 'GET' | 'DELETE', path: string) => {
      calls.push(method + ' ' + path); return { status, json: async () => ({}) }
    }
    assert.equal(await cancelGoogleEvent(request(204), 'primary', INPUT.googleEventId), 'cancelled')
    assert.equal(await cancelGoogleEvent(request(410), 'primary', INPUT.googleEventId), 'already_cancelled')
    assert.equal(await cancelGoogleEvent(request(404), 'primary', INPUT.googleEventId), 'not_found')
    await assert.rejects(cancelGoogleEvent(request(500), 'primary', INPUT.googleEventId), /CANCEL_UNCONFIRMED/)
    assert.equal(calls[0], 'DELETE calendars/primary/events/' + INPUT.googleEventId + '?sendUpdates=all')
  })

  it('criação no Google: UMA chamada com convite; se o Google recusar o convidado (403), UMA nova tentativa sem ele', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = []
    const insert = (statuses: number[]) => async (path: string, body: unknown) => {
      calls.push({ path, body: body as Record<string, unknown> })
      const status = statuses.shift() ?? 500
      return { status, json: status === 200 ? { id: INPUT.googleEventId, hangoutLink: 'https://meet.google.com/abc-defg-hij',
        attendees: (body as { attendees?: unknown }).attendees } : null }
    }
    const ok = await insertBookingEvent(insert([200]), 'primary', { ...INPUT, attendeeEmail: LEAD })
    assert.equal(calls.length, 1)
    assert.match(calls[0].path, /sendUpdates=all/)
    assert.equal(ok.invitationRequested, true)
    calls.length = 0
    let retried = 0
    const fallback = await insertBookingEvent(insert([403, 200]), 'primary', { ...INPUT, attendeeEmail: LEAD }, () => { retried++ })
    assert.equal(calls.length, 2)
    assert.equal(retried, 1)
    assert.equal(calls[0].body.id, calls[1].body.id, 'mesmo id de evento: nunca dois eventos')
    assert.match(calls[1].path, /sendUpdates=none/)
    assert.equal('attendees' in calls[1].body, false)
    assert.deepEqual([fallback.invitationRequested, fallback.meetingUrl], [false, 'https://meet.google.com/abc-defg-hij'])
    calls.length = 0
    await assert.rejects(insertBookingEvent(insert([409]), 'primary', { ...INPUT, attendeeEmail: LEAD }), /UNAVAILABLE/)
    await assert.rejects(insertBookingEvent(insert([500]), 'primary', { ...INPUT, attendeeEmail: LEAD }), /UNAVAILABLE/)
    await assert.rejects(insertBookingEvent(insert([403]), 'primary', INPUT), /UNAVAILABLE/)
    assert.equal(calls.length, 3, '409/500 e 403 sem convidado não são repetidos')
  })
})
