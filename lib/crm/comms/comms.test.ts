import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { readEmailConfig, readWhatsappConfig, publicCommsStatus, FREE_PLAN_DAILY_CAP } from './config'
import { generatePublicReference, isPublicReference, REFERENCE_LENGTH } from './reference'
import { buildLeadWhatsappLink, leadWhatsappMessage, referenceFromIncomingMessage } from './whatsapp-lead'
import { dedupeKey, planMeetingEmails, MIN_GAP_MS } from './plan'
import { fromWallClock, hourOfMeetingDay, wallClock } from './sao-paulo'
import { renderMeetingEmail, renderWhatsappAutoReply, escapeHtml } from './templates'
import { maskEmail, maskPhone } from './mask'
import { cancelEmail, parseWebhookEvent, verifyWebhookSignature, withinNativeScheduleWindow } from './resend'
import {
  checkSender, parseIncomingMessages, verifyChallenge, verifyPayloadSignature, withinServiceWindow,
} from './whatsapp-cloud'
import { parseBrazilianWhatsapp } from '../whatsapp'

/** Ambiente mínimo que o CRM considera válido (Production do projeto cassiellos-crm). */
const PROD = { VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true' }

/* ------------------------------------------------------------------ config */

test('config: tudo desligado sem variável nenhuma', () => {
  const email = readEmailConfig({})
  assert.equal(email.ready, false)
  assert.equal(email.confirmation, false)
  assert.equal(email.reminders, false)
  assert.equal(email.apiKey, null)
  const whatsapp = readWhatsappConfig({})
  assert.equal(whatsapp.buttonReady, false)
  assert.equal(whatsapp.cloudReady, false)
  assert.equal(whatsapp.autoReply, false)
})

test('config: ambiente certo e chave geral não bastam sem credencial', () => {
  const email = readEmailConfig({ ...PROD, COMMS_RESEND_ENABLED: 'true' })
  assert.equal(email.ready, false)
  assert.ok(email.issues.includes('API_KEY_MISSING'))
})

test('config: e-mail pronto, mas confirmação e lembretes continuam separados', () => {
  const base = { ...PROD, COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_x' }
  assert.equal(readEmailConfig(base).ready, true)
  assert.equal(readEmailConfig(base).confirmation, false)
  assert.equal(readEmailConfig({ ...base, COMMS_EMAIL_CONFIRMATION: 'true' }).confirmation, true)
  assert.equal(readEmailConfig({ ...base, COMMS_EMAIL_CONFIRMATION: 'true' }).reminders, false)
})

test('config: remetente com quebra de linha é recusado (injeção de cabeçalho)', () => {
  const email = readEmailConfig({
    ...PROD, COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_x',
    RESEND_FROM: 'Cassiellos <a@b.com>\nBcc: alguem@outro.com',
  })
  assert.ok(email.issues.includes('FROM_INVALID'))
  assert.equal(email.ready, false)
})

test('config: a trava do plano gratuito nunca pode ser AUMENTADA por variável', () => {
  assert.equal(readEmailConfig({ COMMS_EMAIL_DAILY_CAP: '999999' }).dailyCap, FREE_PLAN_DAILY_CAP)
  assert.equal(readEmailConfig({ COMMS_EMAIL_DAILY_CAP: '40' }).dailyCap, 40)
  assert.equal(readEmailConfig({ COMMS_EMAIL_DAILY_CAP: 'abc' }).dailyCap, FREE_PLAN_DAILY_CAP)
})

test('config: botão do WhatsApp exige número válido e não depende da Cloud API', () => {
  const base = { ...PROD, COMMS_WHATSAPP_BUTTON: 'true' }
  assert.equal(readWhatsappConfig(base).buttonReady, false, 'sem número')
  assert.equal(readWhatsappConfig({ ...base, COMMS_WHATSAPP_NUMBER: '31 9999' }).buttonReady, false)
  const ok = readWhatsappConfig({ ...base, COMMS_WHATSAPP_NUMBER: '31991234567' })
  assert.equal(ok.buttonReady, true)
  assert.equal(ok.cloudReady, false, 'Modo B segue desligado')
})

test('config: Cloud API só liga com as quatro credenciais', () => {
  const base = {
    ...PROD, COMMS_WHATSAPP_CLOUD: 'true', WHATSAPP_VERIFY_TOKEN: 't',
    WHATSAPP_APP_SECRET: 's', WHATSAPP_PHONE_NUMBER_ID: '1',
  }
  assert.equal(readWhatsappConfig(base).cloudReady, false, 'falta o token de acesso')
  const full = readWhatsappConfig({ ...base, WHATSAPP_ACCESS_TOKEN: 'a' })
  assert.equal(full.cloudReady, true)
  assert.equal(full.autoReply, false, 'resposta automática é outra chave')
})

test('config: estado público não vaza segredo nenhum', () => {
  const status = publicCommsStatus({
    ...PROD, COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_segredo',
    RESEND_WEBHOOK_SECRET: 'whsec_segredo', COMMS_WHATSAPP_NUMBER: '31991234567',
    WHATSAPP_ACCESS_TOKEN: 'token_segredo', WHATSAPP_APP_SECRET: 'app_segredo',
  })
  const dump = JSON.stringify(status)
  for (const secret of ['re_segredo', 'whsec_segredo', 'token_segredo', 'app_segredo']) {
    assert.equal(dump.includes(secret), false, 'vazou ' + secret)
  }
  assert.equal(status.email.webhookConfigured, true)
})

/* --------------------------------------------------------------- referência */

test('referência: formato estável e sem caracteres ambíguos', () => {
  for (let i = 0; i < 200; i++) {
    const ref = generatePublicReference()
    assert.equal(ref.length, REFERENCE_LENGTH)
    assert.ok(isPublicReference(ref), ref)
    assert.equal(/[0o1li]/.test(ref), false, 'caractere ambíguo em ' + ref)
  }
})

test('referência: valores inválidos não passam', () => {
  for (const bad of ['', 'abc', 'ABCDEFGHJK', 'abcdefghj0', 'abcdefghjkl', null, 42, undefined]) {
    assert.equal(isPublicReference(bad), false, String(bad))
  }
})

test('referência: o sorteio usa todo o alfabeto (sem viés grosseiro)', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) for (const c of generatePublicReference()) seen.add(c)
  assert.ok(seen.size >= 28, 'só ' + seen.size + ' símbolos distintos')
})

/* --------------------------------------------------- WhatsApp Modo A (link) */

test('Modo A: o lead confirma a reunião amanhã às 17 horas, com referência e sem PII', () => {
  const ref = 'abcdefghjk'
  const now = new Date('2026-11-19T13:00:00Z') // 10h de Brasília, dia 19
  const start = '2026-11-20T20:00:00Z' // 17h de Brasília, dia 20
  const text = leadWhatsappMessage(ref, start, now)
  assert.equal(text, 'Olá! Passando para confirmar nossa reunião amanhã às 17 horas. Referência: abcdefghjk.')
  assert.equal(/@|\+55|meet\.google/.test(text!), false, 'sem PII ou link do Meet')
  assert.equal(referenceFromIncomingMessage(text), ref, 'referência continua compatível com o webhook')
})

test('Modo A: mesmo dia usa hoje; horários com minutos e datas futuras estão corretos', () => {
  const ref = 'abcdefghjk'
  const now = new Date('2026-11-19T13:00:00Z')
  assert.match(leadWhatsappMessage(ref, '2026-11-19T20:00:00Z', now)!, /hoje às 17 horas/)
  assert.match(leadWhatsappMessage(ref, '2026-11-20T20:30:00Z', now)!, /amanhã às 17h30/)
  assert.match(leadWhatsappMessage(ref, '2027-01-02T17:30:00Z', now)!, /no dia 02\/01\/2027 às 14h30/)
  assert.match(leadWhatsappMessage(ref, '2026-11-19T04:00:00Z', new Date('2026-11-18T23:00:00Z'))!, /hoje à 1 hora/)
})

test('Modo A: usa o dia de Brasília na virada da meia-noite, não o dia UTC', () => {
  const start = '2026-11-20T03:15:00Z' // 00h15 de Brasília em 20/11
  const beforeLocalMidnight = new Date('2026-11-20T02:59:59Z')
  const afterLocalMidnight = new Date('2026-11-20T03:00:00Z')
  assert.match(leadWhatsappMessage('abcdefghjk', start, beforeLocalMidnight)!, /amanhã às 0h15/)
  assert.match(leadWhatsappMessage('abcdefghjk', start, afterLocalMidnight)!, /hoje às 0h15/)
})

test('Modo A: link aponta para o número comercial e codifica texto e data no wa.me', () => {
  const phone = parseBrazilianWhatsapp('31991234567')
  const link = buildLeadWhatsappLink(phone, 'abcdefghjk', '2026-11-20T20:00:00Z', new Date('2026-11-19T13:00:00Z'))
  assert.equal(link.ok, true)
  if (!link.ok) return
  const url = new URL(link.url)
  assert.equal(url.origin, 'https://wa.me')
  assert.equal(url.pathname, '/5531991234567')
  assert.equal(url.searchParams.get('text'), 'Olá! Passando para confirmar nossa reunião amanhã às 17 horas. Referência: abcdefghjk.')
})

test('Modo A: sem número comercial não existe botão', () => {
  const link = buildLeadWhatsappLink(null, 'abcdefghjk', '2026-11-20T20:00:00Z')
  assert.equal(link.ok, false)
  if (link.ok) return
  assert.equal(link.reason, 'BUSINESS_NUMBER_UNAVAILABLE')
})

test('Modo A: referência e data inválidas não geram link', () => {
  const phone = parseBrazilianWhatsapp('31991234567')
  const badRef = buildLeadWhatsappLink(phone, 'nao-e-ref', '2026-11-20T20:00:00Z')
  const badDate = buildLeadWhatsappLink(phone, 'abcdefghjk', 'data-inválida')
  assert.deepEqual(badRef, { ok: false, reason: 'INVALID_REFERENCE' })
  assert.deepEqual(badDate, { ok: false, reason: 'INVALID_MEETING_DATE' })
})

test('Modo B: lê a referência da mensagem recebida, com e sem acento', () => {
  assert.equal(referenceFromIncomingMessage('… Referência: abcdefghjk.'), 'abcdefghjk')
  assert.equal(referenceFromIncomingMessage('referencia abcdefghjk'), 'abcdefghjk')
  assert.equal(referenceFromIncomingMessage('REFERÊNCIA: ABCDEFGHJK'), 'abcdefghjk')
  assert.equal(referenceFromIncomingMessage('oi, tudo bem?'), null)
  assert.equal(referenceFromIncomingMessage('Referência: abc'), null)
  assert.equal(referenceFromIncomingMessage('x'.repeat(5000)), null)
})

/* -------------------------------------------------------------- plano/fila */

const APPT = '11111111-2222-3333-4444-555555555555'

/** Horário de parede em Brasília → instante, para os testes serem lidos como a agência pensa. */
function sp(text: string): Date {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!m) throw new Error('data de teste inválida: ' + text)
  return fromWallClock(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]))
}

/** Devolve a sequência como horários de Brasília, para comparar com o que foi pedido. */
function sequence(bookedAt: string, meetingAt: string): [string, string][] {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: sp(meetingAt).toISOString(), confirmation: true, reminders: true },
    sp(bookedAt))
  return planned.map(p => {
    const w = wallClock(new Date(p.sendAt))
    const pad = (n: number) => String(n).padStart(2, '0')
    return [p.kind, pad(w.day) + '/' + pad(w.month) + ' ' + pad(w.hour) + ':' + pad(w.minute)] as [string, string]
  })
}

/* Os quatro exemplos obrigatórios, escritos como foram especificados. */

test('exemplo 1 — agenda 23h30 para reunião 10h30 do dia seguinte: 23h30, 8h e 9h30', () => {
  assert.deepEqual(sequence('2026-11-18 23:30', '2026-11-19 10:30'), [
    ['confirmation', '18/11 23:30'],
    ['reminder_morning', '19/11 08:00'],
    ['reminder_1h', '19/11 09:30'],
  ])
})

test('exemplo 2 — agenda 7h para reunião 12h: 7h, 8h e 11h', () => {
  assert.deepEqual(sequence('2026-11-18 07:00', '2026-11-18 12:00'), [
    ['confirmation', '18/11 07:00'],
    ['reminder_morning', '18/11 08:00'],
    ['reminder_1h', '18/11 11:00'],
  ])
})

test('exemplo 3 — agenda 9h para reunião 12h: 9h e 11h (as 8h já passaram)', () => {
  assert.deepEqual(sequence('2026-11-18 09:00', '2026-11-18 12:00'), [
    ['confirmation', '18/11 09:00'],
    ['reminder_1h', '18/11 11:00'],
  ])
})

test('exemplo 4 — agenda 10h para reunião 10h30: só a confirmação', () => {
  assert.deepEqual(sequence('2026-11-18 10:00', '2026-11-18 10:30'), [
    ['confirmation', '18/11 10:00'],
  ])
})

/* Regras de prioridade e respiro mínimo. */

test('prioridade: perto da reunião, quem fica é o lembrete de 1 hora, não o das 8h', () => {
  // Reunião às 9h: as 8h e o lembrete de 1 hora cairiam no mesmo instante.
  assert.deepEqual(sequence('2026-11-18 20:00', '2026-11-19 09:00').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
})

test('o lembrete das 8h exige 1 hora de respiro até o de 1 hora', () => {
  // Reunião às 9h30 → 1 hora antes é 8h30: 30 minutos depois das 8h, perto demais.
  assert.deepEqual(sequence('2026-11-18 20:00', '2026-11-19 09:30').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
  // Reunião às 10h → 1 hora antes é 9h: exatamente 1 hora depois das 8h, cabe.
  assert.deepEqual(sequence('2026-11-18 20:00', '2026-11-19 10:00').map(p => p[0]),
    ['confirmation', 'reminder_morning', 'reminder_1h'])
})

test('reunião de manhã cedo: as 8h cairiam depois dela e não são enviadas', () => {
  assert.deepEqual(sequence('2026-11-18 20:00', '2026-11-19 07:00').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
})

test('o lembrete de 1 hora exige 1 hora de respiro desde a confirmação', () => {
  // Confirmou 10h para reunião 11h30 → lembrete às 10h30, meia hora depois: vira ruído.
  assert.deepEqual(sequence('2026-11-18 10:00', '2026-11-18 11:30').map(p => p[0]), ['confirmation'])
  // Confirmou 10h para reunião 12h → lembrete às 11h, uma hora depois: cabe.
  assert.deepEqual(sequence('2026-11-18 10:00', '2026-11-18 12:00').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
})

test('nunca três mensagens coladas: há sempre ao menos 1 hora entre elas', () => {
  const casos = [
    ['2026-11-18 23:30', '2026-11-19 10:30'], ['2026-11-18 07:00', '2026-11-18 12:00'],
    ['2026-11-18 06:00', '2026-11-18 09:30'], ['2026-11-17 15:00', '2026-11-18 16:00'],
    ['2026-11-18 07:30', '2026-11-18 20:00'], ['2026-11-18 08:00', '2026-11-18 10:00'],
  ]
  for (const [booked, meeting] of casos) {
    const planned = planMeetingEmails(
      { appointmentId: APPT, startAt: sp(meeting).toISOString(), confirmation: true, reminders: true },
      sp(booked))
    const times = planned.map(p => Date.parse(p.sendAt))
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] - times[i - 1] >= MIN_GAP_MS,
        booked + ' → ' + meeting + ': mensagens a menos de 1 hora uma da outra')
      assert.ok(times[i] < Date.parse(sp(meeting).toISOString()), 'mensagem depois da reunião')
    }
  }
})

test('a sequência sai sempre em ordem cronológica', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-19 10:30').toISOString(), confirmation: true, reminders: true },
    sp('2026-11-18 23:30'))
  const times = planned.map(p => Date.parse(p.sendAt))
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
})

/* Virada de dia e fuso. */

test('virada de dia: reunião logo após a meia-noite usa as 8h do DIA DELA', () => {
  // Reunião 00h30 do dia 19 → as 8h do dia 19 são DEPOIS da reunião; só o lembrete de 1 hora.
  assert.deepEqual(sequence('2026-11-18 14:00', '2026-11-19 00:30').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
})

test('virada de dia: reunião às 23h usa as 8h do mesmo dia, não do dia seguinte', () => {
  assert.deepEqual(sequence('2026-11-18 06:00', '2026-11-18 23:00'), [
    ['confirmation', '18/11 06:00'],
    ['reminder_morning', '18/11 08:00'],
    ['reminder_1h', '18/11 22:00'],
  ])
})

test('fuso: as 8h são lidas do fuso, não somadas à mão', () => {
  // Sem horário de verão (hoje): 8h em Brasília = 11h UTC.
  assert.equal(hourOfMeetingDay(new Date('2026-11-20T17:30:00Z'), 8).toISOString(), '2026-11-20T11:00:00.000Z')
  // Com horário de verão (regra vigente em 2018, UTC−2): 8h em Brasília = 10h UTC.
  assert.equal(hourOfMeetingDay(new Date('2018-01-15T15:00:00Z'), 8).toISOString(), '2018-01-15T10:00:00.000Z')
})

test('fuso: o dia da reunião é o dia em BRASÍLIA, não em UTC', () => {
  // 01h30 UTC do dia 21 é 22h30 do dia 20 em Brasília: as 8h são do dia 20.
  assert.equal(hourOfMeetingDay(new Date('2026-11-21T01:30:00Z'), 8).toISOString(), '2026-11-20T11:00:00.000Z')
})

/* Desligamentos e idempotência. */

test('lembretes desligados: só a confirmação', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-19 10:30').toISOString(), confirmation: true, reminders: false },
    sp('2026-11-18 23:30'))
  assert.deepEqual(planned.map(p => p.kind), ['confirmation'])
})

test('confirmação desligada: os lembretes continuam valendo por si', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-19 10:30').toISOString(), confirmation: false, reminders: true },
    sp('2026-11-18 23:30'))
  assert.deepEqual(planned.map(p => p.kind), ['reminder_morning', 'reminder_1h'])
})

test('data inválida não gera mensagem nenhuma', () => {
  assert.deepEqual(planMeetingEmails(
    { appointmentId: APPT, startAt: 'nao-e-data', confirmation: true, reminders: true }), [])
})

test('além de 30 dias os lembretes saem da janela nativa da Resend', () => {
  const longe = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2027-02-10 14:00').toISOString(), confirmation: false, reminders: true },
    sp('2026-11-18 10:00'))
  assert.deepEqual(longe.map(p => p.nativeSchedule), [false, false])
  const perto = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-28 14:00').toISOString(), confirmation: false, reminders: true },
    sp('2026-11-18 10:00'))
  assert.deepEqual(perto.map(p => p.nativeSchedule), [true, true])
})

test('plano: a chave de idempotência distingue reunião, tipo e horário', () => {
  const t1 = '2026-11-19T13:30:00.000Z'
  const t2 = '2026-11-19T16:00:00.000Z'
  assert.equal(dedupeKey('email', 'confirmation', APPT, t1), 'email:confirmation:' + APPT + ':202611191330')
  assert.notEqual(dedupeKey('email', 'reminder_1h', APPT, t1), dedupeKey('email', 'reminder_morning', APPT, t1))
  // Remarcação: mesmo tipo e mesma reunião, horário diferente → chave diferente, sem colidir com a cancelada.
  assert.notEqual(dedupeKey('email', 'reminder_1h', APPT, t1), dedupeKey('email', 'reminder_1h', APPT, t2))
  // Reconfirmar o MESMO horário dá a mesma chave: nada duplica.
  assert.equal(dedupeKey('email', 'reminder_1h', APPT, t1), dedupeKey('email', 'reminder_1h', APPT, t1))
  // WhatsApp ignora o horário: uma resposta automática por reunião, sempre.
  assert.equal(dedupeKey('whatsapp', 'whatsapp_auto_reply', APPT, t1),
    dedupeKey('whatsapp', 'whatsapp_auto_reply', APPT, t2))
})

test('remarcação: a sequência inteira é recalculada para o novo horário', () => {
  const antes = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-19 10:30').toISOString(), confirmation: false, reminders: true },
    sp('2026-11-18 23:30'))
  const depois = planMeetingEmails(
    { appointmentId: APPT, startAt: sp('2026-11-19 16:00').toISOString(), confirmation: false, reminders: true },
    sp('2026-11-18 23:30'))
  assert.deepEqual(antes.map(p => p.kind), ['reminder_morning', 'reminder_1h'])
  assert.deepEqual(depois.map(p => p.kind), ['reminder_morning', 'reminder_1h'])
  // As 8h continuam sendo as 8h; o lembrete final acompanha o novo horário.
  assert.equal(antes[0].sendAt, depois[0].sendAt)
  assert.notEqual(antes[1].sendAt, depois[1].sendAt)
  // E nenhuma chave da sequência nova colide com a antiga.
  const antigas = new Set(antes.map(p => p.dedupeKey))
  assert.ok(depois.every(p => !antigas.has(p.dedupeKey)))
})

test('remarcação para cima da hora: a nova sequência pode encolher', () => {
  // Remarcada de 10h30 para 8h30 do mesmo dia: as 8h não cabem mais, só o lembrete de 1 hora.
  assert.deepEqual(sequence('2026-11-18 23:30', '2026-11-19 08:30').map(p => p[0]),
    ['confirmation', 'reminder_1h'])
})

test('janela nativa: passado e futuro distante ficam de fora', () => {
  const now = new Date('2026-11-18T12:00:00.000Z')
  assert.equal(withinNativeScheduleWindow(new Date(now.getTime() - 1000), now), false)
  assert.equal(withinNativeScheduleWindow(new Date(now.getTime() + 1000), now), true)
  assert.equal(withinNativeScheduleWindow(new Date(now.getTime() + 31 * 86_400_000), now), false)
})

/* ---------------------------------------------------------------- modelos */

const MEETING = {
  name: 'Ana Paula Souza', startAt: '2026-11-20T17:30:00.000Z', endAt: '2026-11-20T18:00:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij', meetingTitle: 'Diagnóstico estratégico · Cassiellos',
}

test('e-mail: confirmação traz nome, data, horário de Brasília, Meet e agenda', () => {
  const mail = renderMeetingEmail('confirmation', MEETING)
  assert.equal(mail.subject, 'Sua reunião com a Cassiellos está confirmada!')
  assert.ok(mail.html.includes('Ana'), 'primeiro nome')
  assert.ok(mail.html.includes('14:30'), 'horário convertido para Brasília (UTC-3)')
  assert.ok(mail.html.includes('novembro'))
  assert.ok(mail.html.includes('https://meet.google.com/abc-defg-hij'))
  assert.ok(mail.html.includes('calendar.google.com'))
  assert.ok(mail.html.includes('Agência Cassiellos'))
  assert.ok(mail.text.includes('14:30'))
})

test('e-mail: lembretes têm assunto próprio e o mesmo conteúdo essencial', () => {
  for (const kind of ['reminder_morning', 'reminder_1h'] as const) {
    const mail = renderMeetingEmail(kind, MEETING)
    assert.notEqual(mail.subject, 'Sua reunião com a Cassiellos está confirmada!')
    assert.ok(mail.html.includes('https://meet.google.com/abc-defg-hij'))
    assert.ok(mail.text.length > 80)
  }
})

test('e-mail: sem link do Meet o modelo não mente', () => {
  const mail = renderMeetingEmail('confirmation', { ...MEETING, meetUrl: null })
  assert.equal(mail.html.includes('Entrar no Google Meet'), false)
  assert.ok(mail.html.includes('O horário está reservado'))
})

test('e-mail: link que não é do Meet é descartado', () => {
  const mail = renderMeetingEmail('confirmation', { ...MEETING, meetUrl: 'https://evil.example/meet' })
  assert.equal(mail.html.includes('evil.example'), false)
})

test('e-mail: nome vindo do formulário é escapado', () => {
  const mail = renderMeetingEmail('confirmation', { ...MEETING, name: '<script>alert(1)</script>' })
  assert.equal(mail.html.includes('<script>'), false)
  assert.ok(mail.html.includes('&lt;script&gt;'))
})

test('e-mail: sem nome o tratamento continua natural', () => {
  const mail = renderMeetingEmail('confirmation', { ...MEETING, name: null })
  assert.ok(mail.html.includes('Olá'))
  assert.equal(mail.html.includes('Olá, null'), false)
})

test('e-mail: não carrega imagem remota (nada de pixel de rastreio)', () => {
  const mail = renderMeetingEmail('confirmation', MEETING)
  assert.equal(/<img/i.test(mail.html), false)
})

test('escapeHtml cobre os cinco caracteres', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
})

test('WhatsApp: resposta automática usa os dados reais da reunião', () => {
  const body = renderWhatsappAutoReply(MEETING)
  assert.ok(body.includes('Ana'))
  assert.ok(body.includes('14:30'))
  assert.ok(body.includes('https://meet.google.com/abc-defg-hij'))
  assert.ok(body.includes('Equipe Cassiellos'))
})

/* ------------------------------------------------------------- mascaramento */

test('máscara: e-mail preserva o domínio e esconde a conta', () => {
  assert.equal(maskEmail('joao.silva@gmail.com'), 'jo***@gmail.com')
  assert.equal(maskEmail('a@b.com'), 'a***@b.com')
  assert.equal(maskEmail('sem-arroba'), null)
  assert.equal(maskEmail('a@b'), null)
  assert.equal(maskEmail(null), null)
})

test('máscara: telefone mantém DDD e dois últimos dígitos', () => {
  const masked = maskPhone('5531991234567')
  assert.ok(masked && masked.includes('(31)'))
  assert.ok(masked.endsWith('67'))
  assert.equal(masked.includes('91234'), false)
  assert.equal(maskPhone('123'), null)
})

/* ------------------------------------------------------- webhook da Resend */

function svix(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64')
  return 'v1,' + createHmac('sha256', key).update(id + '.' + timestamp + '.' + body).digest('base64')
}

const SECRET = 'whsec_' + Buffer.from('segredo-de-teste-123456').toString('base64')

test('webhook Resend: assinatura correta passa', () => {
  const body = '{"type":"email.delivered"}'
  const ts = String(Math.floor(Date.now() / 1000))
  const check = verifyWebhookSignature(SECRET, {
    id: 'msg_1', timestamp: ts, signature: svix(SECRET, 'msg_1', ts, body),
  }, body)
  assert.equal(check.ok, true)
})

test('webhook Resend: corpo alterado é recusado', () => {
  const ts = String(Math.floor(Date.now() / 1000))
  const signature = svix(SECRET, 'msg_1', ts, '{"type":"email.delivered"}')
  const check = verifyWebhookSignature(SECRET, { id: 'msg_1', timestamp: ts, signature }, '{"type":"email.bounced"}')
  assert.equal(check.ok, false)
  if (check.ok) return
  assert.equal(check.reason, 'BAD_SIGNATURE')
})

test('webhook Resend: evento antigo é recusado (proteção contra reenvio)', () => {
  const body = '{}'
  const old = String(Math.floor(Date.now() / 1000) - 3600)
  const check = verifyWebhookSignature(SECRET, {
    id: 'msg_1', timestamp: old, signature: svix(SECRET, 'msg_1', old, body),
  }, body)
  assert.equal(check.ok, false)
  if (check.ok) return
  assert.equal(check.reason, 'STALE')
})

test('webhook Resend: cabeçalho faltando é recusado', () => {
  const check = verifyWebhookSignature(SECRET, { id: null, timestamp: null, signature: null }, '{}')
  assert.equal(check.ok, false)
})

test('webhook Resend: só eventos conhecidos viram mudança de estado', () => {
  assert.deepEqual(
    parseWebhookEvent({ type: 'email.delivered', data: { email_id: 'e1' } }),
    { type: 'email.delivered', emailId: 'e1', status: 'delivered' })
  assert.equal(parseWebhookEvent({ type: 'email.bounced', data: { email_id: 'e1' } })?.status, 'failed')
  assert.equal(parseWebhookEvent({ type: 'email.opened', data: { email_id: 'e1' } }), null)
  assert.equal(parseWebhookEvent({ type: 'email.delivered' }), null)
  assert.equal(parseWebhookEvent(null), null)
})

/* --------------------------------------------------- WhatsApp Cloud (Modo B) */

test('Cloud: handshake só responde com o token exato', () => {
  assert.equal(verifyChallenge('tok', { mode: 'subscribe', token: 'tok', challenge: '1234' }), '1234')
  assert.equal(verifyChallenge('tok', { mode: 'subscribe', token: 'outro', challenge: '1234' }), null)
  assert.equal(verifyChallenge('tok', { mode: 'unsubscribe', token: 'tok', challenge: '1234' }), null)
  assert.equal(verifyChallenge('tok', { mode: 'subscribe', token: 'tok', challenge: '<script>' }), null)
})

test('Cloud: assinatura do corpo confere e recusa adulteração', () => {
  const body = '{"object":"whatsapp_business_account"}'
  const good = 'sha256=' + createHmac('sha256', 'app-secret').update(body, 'utf8').digest('hex')
  assert.equal(verifyPayloadSignature('app-secret', good, body), true)
  assert.equal(verifyPayloadSignature('app-secret', good, body + ' '), false)
  assert.equal(verifyPayloadSignature('outro', good, body), false)
  assert.equal(verifyPayloadSignature('app-secret', null, body), false)
  assert.equal(verifyPayloadSignature('app-secret', 'sha256=zz', body), false)
})

test('Cloud: lê mensagens de texto e ignora o resto', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [
      { field: 'messages', value: { messages: [
        { id: 'wamid.1', from: '5531991234567', type: 'text', timestamp: '1763470800', text: { body: 'Referência: abcdefghjk' } },
        { id: 'wamid.2', from: '5531991234567', type: 'image', timestamp: '1763470800' },
      ] } },
      { field: 'statuses', value: { statuses: [{ id: 'x' }] } },
    ] }],
  }
  const messages = parseIncomingMessages(payload)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageId, 'wamid.1')
  assert.equal(messages[0].text, 'Referência: abcdefghjk')
})

test('Cloud: carga de outro produto é ignorada', () => {
  assert.deepEqual(parseIncomingMessages({ object: 'page', entry: [] }), [])
  assert.deepEqual(parseIncomingMessages(null), [])
  assert.deepEqual(parseIncomingMessages({ object: 'whatsapp_business_account', entry: 'x' }), [])
})

test('Cloud: remetente precisa bater com o contato da reunião', () => {
  assert.equal(checkSender('31991234567', '5531991234567'), 'match')
  assert.equal(checkSender('(31) 99123-4567', '5531991234567'), 'match')
  assert.equal(checkSender('31991234567', '5531999998888'), 'mismatch')
  assert.equal(checkSender(null, '5531991234567'), 'unknown_contact')
  assert.equal(checkSender('31991234567', '999'), 'mismatch')
})

test('Cloud: a janela de atendimento é de 24 h a partir da mensagem do lead', () => {
  const sent = new Date('2026-11-18T12:00:00.000Z')
  assert.equal(withinServiceWindow(sent, new Date('2026-11-18T20:00:00.000Z')), true)
  assert.equal(withinServiceWindow(sent, new Date('2026-11-19T13:00:00.000Z')), false)
  assert.equal(withinServiceWindow(sent, new Date('2026-11-18T11:00:00.000Z')), false)
})

/* ----------------------------------------------- travas de ambiente (Preview) */

test('Preview: sem a trava explícita, nenhuma automação roda', () => {
  const preview = {
    VERCEL_ENV: 'preview', COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_x',
    COMMS_EMAIL_CONFIRMATION: 'true', COMMS_EMAIL_REMINDERS: 'true',
  }
  const email = readEmailConfig(preview)
  assert.equal(email.ready, false)
  assert.equal(email.confirmation, false)
  assert.equal(email.reminders, false)
  assert.ok(email.issues.includes('PREVIEW_NOT_ENABLED'))
})

test('Preview: com COMMS_PREVIEW_ENABLED o teste controlado é possível', () => {
  const email = readEmailConfig({
    VERCEL_ENV: 'preview', COMMS_PREVIEW_ENABLED: 'true', COMMS_RESEND_ENABLED: 'true',
    RESEND_API_KEY: 're_x', COMMS_EMAIL_CONFIRMATION: 'true',
  })
  assert.equal(email.ready, true)
  assert.equal(email.confirmation, true)
})

test('Preview: o botão de WhatsApp também fica preso à trava', () => {
  const base = { VERCEL_ENV: 'preview', COMMS_WHATSAPP_BUTTON: 'true', COMMS_WHATSAPP_NUMBER: '31991234567' }
  assert.equal(readWhatsappConfig(base).buttonReady, false)
  assert.equal(readWhatsappConfig({ ...base, COMMS_PREVIEW_ENABLED: 'true' }).buttonReady, true)
})

test('Production do CRM não precisa da trava de Preview', () => {
  const email = readEmailConfig({ ...PROD, COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_x' })
  assert.equal(email.ready, true)
  assert.equal(email.issues.includes('PREVIEW_NOT_ENABLED'), false)
})

test('Fora dos ambientes do CRM nada liga, nem com todas as chaves', () => {
  const email = readEmailConfig({
    VERCEL_ENV: 'production', COMMS_RESEND_ENABLED: 'true', RESEND_API_KEY: 're_x',
    COMMS_PREVIEW_ENABLED: 'true', COMMS_EMAIL_CONFIRMATION: 'true',
  })
  assert.equal(email.ready, false, 'Production do site institucional não é o CRM')
  assert.ok(email.issues.includes('ENV_NOT_SUPPORTED'))
})

test('modelos não prometem resposta em caixa de e-mail sem inbox confirmado', () => {
  for (const kind of ['confirmation', 'reminder_morning', 'reminder_1h'] as const) {
    const email = renderMeetingEmail(kind, MEETING)
    assert.equal(/responda a est[ea] (?:mensagem|e-mail)/i.test(email.text), false)
    assert.equal(/responda a est[ea] (?:mensagem|e-mail)/i.test(email.html), false)
  }
})

test('cancelamento Resend: HTTP 404 é resultado incerto, não confirmação', async () => {
  const fetcher = async () => new Response('{"message":"Not found"}', { status: 404 })
  const result = await cancelEmail(fetcher, 're_test', 'email-id')
  assert.equal(result.ok, false)
})
