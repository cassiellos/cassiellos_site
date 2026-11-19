import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { readEmailConfig, readWhatsappConfig, publicCommsStatus, FREE_PLAN_DAILY_CAP } from './config'
import { generatePublicReference, isPublicReference, REFERENCE_LENGTH } from './reference'
import { buildLeadWhatsappLink, leadWhatsappMessage, referenceFromIncomingMessage } from './whatsapp-lead'
import { dedupeKey, planMeetingEmails } from './plan'
import { renderMeetingEmail, renderWhatsappAutoReply, escapeHtml } from './templates'
import { maskEmail, maskPhone } from './mask'
import { parseWebhookEvent, verifyWebhookSignature, withinNativeScheduleWindow } from './resend'
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

test('Modo A: a mensagem leva só a referência, nada do lead', () => {
  const ref = 'abcdefghjk'
  const text = leadWhatsappMessage(ref)
  assert.ok(text && text.includes(ref))
  assert.ok(text.startsWith('Olá! Acabei de agendar'))
  assert.equal(/@|\+55|meet\.google/.test(text), false, 'não pode conter dado pessoal nem link')
})

test('Modo A: link aponta para o número comercial e codifica o texto', () => {
  const phone = parseBrazilianWhatsapp('31991234567')
  const link = buildLeadWhatsappLink(phone, 'abcdefghjk')
  assert.equal(link.ok, true)
  if (!link.ok) return
  assert.ok(link.url.startsWith('https://wa.me/5531991234567?text='))
  assert.ok(link.url.includes('abcdefghjk'))
})

test('Modo A: sem número comercial não existe botão', () => {
  const link = buildLeadWhatsappLink(null, 'abcdefghjk')
  assert.equal(link.ok, false)
  if (link.ok) return
  assert.equal(link.reason, 'BUSINESS_NUMBER_UNAVAILABLE')
})

test('Modo A: referência inválida não vira link', () => {
  const link = buildLeadWhatsappLink(parseBrazilianWhatsapp('31991234567'), 'nao-e-ref')
  assert.equal(link.ok, false)
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
const NOW = new Date('2026-11-18T12:00:00.000Z')
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

test('plano: reunião distante gera confirmação e os dois lembretes', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(72), confirmation: true, reminders: true }, NOW)
  assert.deepEqual(planned.map(p => p.kind), ['confirmation', 'reminder_24h', 'reminder_1h'])
  assert.equal(planned[1].sendAt, inHours(48))
  assert.equal(planned[2].sendAt, inHours(71))
  assert.ok(planned.every(p => p.dedupeKey.startsWith('email:')))
})

test('plano: reunião em 2 h não gera lembrete de 24 h (nada retroativo)', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(2), confirmation: true, reminders: true }, NOW)
  assert.deepEqual(planned.map(p => p.kind), ['confirmation', 'reminder_1h'])
})

test('plano: reunião em 30 min só gera a confirmação', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(0.5), confirmation: true, reminders: true }, NOW)
  assert.deepEqual(planned.map(p => p.kind), ['confirmation'])
})

test('plano: lembretes desligados não criam linha nenhuma', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(72), confirmation: true, reminders: false }, NOW)
  assert.deepEqual(planned.map(p => p.kind), ['confirmation'])
})

test('plano: além de 30 dias o lembrete sai da janela nativa da Resend', () => {
  const planned = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(24 * 60), confirmation: false, reminders: true }, NOW)
  assert.deepEqual(planned.map(p => p.nativeSchedule), [false, false])
  const perto = planMeetingEmails(
    { appointmentId: APPT, startAt: inHours(24 * 10), confirmation: false, reminders: true }, NOW)
  assert.deepEqual(perto.map(p => p.nativeSchedule), [true, true])
})

test('plano: a chave de idempotência é por reunião e tipo', () => {
  assert.equal(dedupeKey('email', 'confirmation', APPT), 'email:confirmation:' + APPT)
  assert.notEqual(dedupeKey('email', 'reminder_1h', APPT), dedupeKey('email', 'reminder_24h', APPT))
})

test('janela nativa: passado e futuro distante ficam de fora', () => {
  assert.equal(withinNativeScheduleWindow(new Date(NOW.getTime() - 1000), NOW), false)
  assert.equal(withinNativeScheduleWindow(new Date(NOW.getTime() + 1000), NOW), true)
  assert.equal(withinNativeScheduleWindow(new Date(NOW.getTime() + 31 * 86_400_000), NOW), false)
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
  for (const kind of ['reminder_24h', 'reminder_1h'] as const) {
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
