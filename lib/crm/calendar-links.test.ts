import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildIcs, googleCalendarTemplateUrl } from './calendar-links'

const ENTRY = {
  title: 'Diagnóstico estratégico Cassiellos', startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T12:30:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
}

describe('adicionar à agenda — sem convite', () => {
  it('Google Agenda: link de modelo para a agenda do próprio visitante, sem convidados', () => {
    const url = new URL(googleCalendarTemplateUrl(ENTRY))
    assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render')
    assert.equal(url.searchParams.get('action'), 'TEMPLATE')
    assert.equal(url.searchParams.get('text'), ENTRY.title)
    assert.equal(url.searchParams.get('dates'), '20261103T120000Z/20261103T123000Z')
    assert.equal(url.searchParams.get('location'), ENTRY.meetUrl)
    assert.equal(url.searchParams.get('add'), null) // nenhum convidado
    assert.match(url.searchParams.get('details') ?? '', /Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/)
  })

  it('link do Meet inválido não entra no modelo', () => {
    const url = new URL(googleCalendarTemplateUrl({ ...ENTRY, meetUrl: 'javascript:alert(1)' }))
    assert.equal(url.searchParams.get('location'), null)
    assert.doesNotMatch(url.searchParams.get('details') ?? '', /javascript/)
  })

  it('.ics: METHOD:PUBLISH, sem ORGANIZER/ATTENDEE (compromisso pessoal, não convite), CRLF', () => {
    const ics = buildIcs({ ...ENTRY, uid: '6f1d2c3b-1111-4222-8333-444455556666', now: new Date('2026-10-30T11:00:00Z') })
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
    assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/)
    assert.doesNotMatch(ics, /ORGANIZER|ATTENDEE|mailto:|METHOD:REQUEST/)
    assert.match(ics, /\r\nDTSTART:20261103T120000Z\r\n/)
    assert.match(ics, /\r\nDTEND:20261103T123000Z\r\n/)
    assert.match(ics, /\r\nDTSTAMP:20261030T110000Z\r\n/)
    assert.match(ics, /\r\nUID:6f1d2c3b-1111-4222-8333-444455556666@agendamento\.cassiellos\.com\.br\r\n/)
    assert.match(ics, /\r\nURL:https:\/\/meet\.google\.com\/abc-defg-hij\r\n/)
    assert.match(ics, /\r\nEND:VCALENDAR\r\n$/)
    for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
  })

  it('.ics: escapa texto (vírgula, ponto e vírgula, quebra de linha) e funciona sem Meet', () => {
    const ics = buildIcs({ ...ENTRY, title: 'Reunião; teste, com\nquebra', meetUrl: null, uid: 'x' })
    assert.match(ics, /SUMMARY:Reunião\\; teste\\, com\\nquebra/)
    assert.doesNotMatch(ics, /LOCATION|URL:/)
  })

  it('datas inválidas são recusadas', () => {
    assert.throws(() => googleCalendarTemplateUrl({ ...ENTRY, startAt: 'amanhã' }), /INVALID_DATE/)
  })
})
