import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bookingEventDescription, buildBookingEventRequest, isGoogleMeetUrl, parseCreatedEvent } from './booking-event'
import { cancelGoogleEvent } from './google-event-ops'

const INPUT = {
  title: 'Diagnóstico estratégico Cassiellos', startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T12:30:00.000Z',
  requestId: '6f1d2c3b-1111-4222-8333-444455556666', googleEventId: 'c6f1d2c3b111142228333444455556666', reference: '6f1d2c3b',
}

describe('evento do agendamento público — sem convidados', () => {
  it('criação sem attendees e com sendUpdates=none (nenhum convite ou e-mail automático)', () => {
    const { path, body } = buildBookingEventRequest('primary', INPUT)
    assert.equal(path, 'calendars/primary/events?sendUpdates=none&conferenceDataVersion=1')
    assert.equal('attendees' in body, false)
    assert.doesNotMatch(JSON.stringify(body), /@|attendee|mailto/i)
    assert.equal(body.guestsCanInviteOthers, false)
  })

  it('Google Meet preservado: conferenceData hangoutsMeet com requestId idempotente', () => {
    const { body } = buildBookingEventRequest('primary', INPUT)
    assert.deepEqual(body.conferenceData, { createRequest: { requestId: INPUT.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } })
    assert.equal(body.id, INPUT.googleEventId)
    assert.deepEqual(body.start, { dateTime: INPUT.startAt, timeZone: 'America/Sao_Paulo' })
  })

  it('título e descrição sem dados pessoais; apenas referência interna', () => {
    const { body } = buildBookingEventRequest('agenda@exemplo.com', INPUT)
    assert.equal(body.summary, INPUT.title)
    assert.match(String(body.description), /Referência no Mini CRM: 6f1d2c3b/)
    assert.throws(() => bookingEventDescription('maria@exemplo.com'), /REFERENCE_INVALID/)
    assert.throws(() => bookingEventDescription('Maria Silva'), /REFERENCE_INVALID/)
    assert.throws(() => bookingEventDescription('31 99999-0000'), /REFERENCE_INVALID/)
  })

  it('id da agenda é codificado no caminho', () => {
    assert.equal(buildBookingEventRequest('a/b?c', INPUT).path.startsWith('calendars/a%2Fb%3Fc/events?'), true)
  })

  it('resposta do Google: Meet só de meet.google.com; sem id = não confirmado (falha da API)', () => {
    assert.deepEqual(parseCreatedEvent({ id: 'evt1', hangoutLink: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://www.google.com/calendar/event?eid=x' }),
      { id: 'evt1', meetingUrl: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://www.google.com/calendar/event?eid=x' })
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

  it('cancelamento de evento sem convidados: DELETE do evento; 404/410 tratados; erro não confirma', async () => {
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
})
