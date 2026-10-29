import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bookingEventId, cancelGoogleEvent, readGoogleEventState, type GoogleRequest } from './google-event-ops'

function fake(status: number, body: unknown = {}, calls: string[] = []): GoogleRequest {
  return async (method, path) => { calls.push(method + ' ' + path); return { status, json: async () => body } }
}
const EVENT = bookingEventId('3f2b1c4d-0000-4000-8000-00000000abcd')

describe('cancelGoogleEvent — só confirma o que o Google confirmou', () => {
  it('204/200 = cancelado (DELETE com aviso ao participante)', async () => {
    const calls: string[] = []
    assert.equal(await cancelGoogleEvent(fake(204, {}, calls), 'primary', EVENT), 'cancelled')
    assert.deepEqual(calls, ['DELETE calendars/primary/events/' + EVENT + '?sendUpdates=all'])
    assert.equal(await cancelGoogleEvent(fake(200), 'primary', EVENT), 'cancelled')
  })
  it('410 = já estava cancelado; 404 = evento inexistente', async () => {
    assert.equal(await cancelGoogleEvent(fake(410), 'primary', EVENT), 'already_cancelled')
    assert.equal(await cancelGoogleEvent(fake(404), 'primary', EVENT), 'not_found')
  })
  it('qualquer outra resposta, erro de rede ou tempo esgotado = NÃO confirmado (lança)', async () => {
    for (const status of [401, 403, 409, 412, 429, 500, 503]) {
      await assert.rejects(cancelGoogleEvent(fake(status), 'primary', EVENT), /CRM_GOOGLE_CANCEL_UNCONFIRMED/, String(status))
    }
    await assert.rejects(cancelGoogleEvent(async () => { throw new Error('timeout') }, 'primary', EVENT), /timeout/)
  })
  it('referências inválidas nunca chegam ao Google', async () => {
    const calls: string[] = []
    await assert.rejects(cancelGoogleEvent(fake(204, {}, calls), 'primary', '../outro'), /INVALID/)
    await assert.rejects(cancelGoogleEvent(fake(204, {}, calls), 'a/b', EVENT), /INVALID/)
    assert.equal(calls.length, 0)
  })
  it('calendário com caracteres especiais é codificado', async () => {
    const calls: string[] = []
    await cancelGoogleEvent(fake(204, {}, calls), 'agenda@group.calendar.google.com', EVENT)
    assert.match(calls[0], /calendars\/agenda%40group\.calendar\.google\.com\/events\//)
  })
})

describe('readGoogleEventState — conferência somente leitura', () => {
  it('evento ativo (com link Meet válido)', async () => {
    assert.deepEqual(await readGoogleEventState(fake(200, { status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij' }), 'primary', EVENT),
      { state: 'active', meetingUrl: 'https://meet.google.com/abc-defg-hij' })
    assert.deepEqual(await readGoogleEventState(fake(200, { status: 'tentative', hangoutLink: 'javascript:alert(1)' }), 'primary', EVENT),
      { state: 'active', meetingUrl: null })
  })
  it('cancelado (200 com status cancelled ou 410) e inexistente (404)', async () => {
    assert.deepEqual(await readGoogleEventState(fake(200, { status: 'cancelled' }), 'primary', EVENT), { state: 'cancelled' })
    assert.deepEqual(await readGoogleEventState(fake(410), 'primary', EVENT), { state: 'cancelled' })
    assert.deepEqual(await readGoogleEventState(fake(404), 'primary', EVENT), { state: 'not_found' })
  })
  it('erros e respostas inesperadas lançam (nada é decidido sem certeza)', async () => {
    await assert.rejects(readGoogleEventState(fake(500), 'primary', EVENT))
    await assert.rejects(readGoogleEventState(fake(200, 'texto'), 'primary', EVENT))
    await assert.rejects(readGoogleEventState(fake(200, {}), 'primary', EVENT))
  })
  it('id do evento derivado da reserva (mesmo usado na criação)', () => {
    assert.equal(bookingEventId('3F2B1C4D-0000-4000-8000-00000000ABCD'), 'c3f2b1c4d000040008000' + '00000000abcd')
  })
})
