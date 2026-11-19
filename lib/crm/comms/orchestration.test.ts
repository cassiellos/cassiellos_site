import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { EmailConfig, WhatsappConfig } from './config'
import { deliverMessage, scheduleMeetingEmails, type SendDeps } from './send'
import { handleIncomingMessage } from './whatsapp-reply'
import type { CommsMessage, Queryable } from './store'

/**
 * Orquestração com banco e rede FALSOS. Nenhum e-mail e nenhuma mensagem de WhatsApp saem daqui.
 * O que está sendo verificado é o que pode dar errado em produção: enviar duas vezes, enviar para
 * reunião cancelada, enviar lembrete depois da hora, estourar a franquia e responder a quem não é
 * o contato da reunião.
 */

const APPT = '11111111-2222-3333-4444-555555555555'
const NOW = new Date('2026-11-18T12:00:00.000Z')

type Capture = { sql: string; params: unknown[] }

/** Banco falso: responde pelo trecho característico de cada consulta. */
function fakePool(options: {
  meeting?: Record<string, unknown> | null
  usage?: number
  claimWhatsapp?: boolean
  reference?: string | null
} = {}): Queryable & { calls: Capture[]; updates: Capture[] } {
  const calls: Capture[] = []
  const updates: Capture[] = []
  const meeting = options.meeting === undefined
    ? {
        id: APPT, lead_id: 'lead-1', full_name: 'Ana Paula', email: 'ana@exemplo.com',
        whatsapp: '31991234567', starts_at: new Date('2026-11-20T17:30:00.000Z'),
        ends_at: new Date('2026-11-20T18:00:00.000Z'),
        meeting_url: 'https://meet.google.com/abc-defg-hij', status: 'confirmed',
      }
    : options.meeting

  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (/^\s*UPDATE|^\s*INSERT/.test(sql)) updates.push({ sql, params })
    if (sql.includes('FROM crm.appointments a JOIN crm.leads')) {
      return { rows: meeting ? [meeting] : [], rowCount: meeting ? 1 : 0 }
    }
    if (sql.includes('count(*)')) return { rows: [{ total: String(options.usage ?? 0) }], rowCount: 1 }
    if (sql.includes('crm.comms_whatsapp_refs') && sql.includes('UPDATE')) {
      return options.reference === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ appointment_id: APPT }], rowCount: 1 }
    }
    if (sql.includes("'whatsapp_auto_reply'")) {
      return options.claimWhatsapp === false
        ? { rows: [], rowCount: 0 }
        : { rows: [row({ channel: 'whatsapp', kind: 'whatsapp_auto_reply' })], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO crm.comms_messages')) return { rows: [row({})], rowCount: 1 }
    if (sql.includes('SET attempts = attempts + 1')) return { rows: [row({})], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { query, calls, updates } as unknown as Queryable & { calls: Capture[]; updates: Capture[] }
}

function row(overrides: Record<string, unknown>) {
  return {
    id: 'msg-1', appointment_id: APPT, channel: 'email', kind: 'confirmation',
    dedupe_key: 'email:confirmation:' + APPT, recipient_masked: 'an***@exemplo.com',
    scheduled_for: null, sent_at: null, provider_message_id: null, status: 'pending',
    attempts: 1, last_error: null, created_at: NOW, ...overrides,
  }
}

function message(overrides: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: 'msg-1', appointmentId: APPT, channel: 'email', kind: 'confirmation',
    dedupeKey: 'email:confirmation:' + APPT, recipientMasked: 'an***@exemplo.com',
    scheduledFor: null, sentAt: null, providerMessageId: null, status: 'pending',
    attempts: 1, lastError: null, createdAt: NOW.toISOString(), ...overrides,
  }
}

const emailConfig = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
  ready: true, confirmation: true, reminders: true, apiKey: 're_fake', from: 'Cassiellos <a@b.com>',
  dailyCap: 100, monthlyCap: 3000, webhookSecret: null, issues: [], ...overrides,
})

/** `fetch` falso: registra o que teria sido enviado e devolve sucesso. Nenhuma rede é tocada. */
function fakeFetch(status = 200, body: unknown = { id: 'resend-1' }) {
  const sent: { url: string; init: RequestInit }[] = []
  const fetcher = async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetcher, sent }
}

function deps(pool: Queryable, fetcher: SendDeps['fetch'], config = emailConfig()): SendDeps {
  return { pool, config, fetch: fetcher, now: () => NOW, log: () => {} }
}

/* --------------------------------------------------------------- e-mail */

test('envio: caminho feliz entrega à Resend e marca como aceita', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  assert.equal(await deliverMessage(deps(pool, fetcher), message()), true)
  assert.equal(sent.length, 1)
  assert.ok(sent[0].url.endsWith('/emails'))
  const payload = JSON.parse(String(sent[0].init.body))
  assert.equal(payload.to, 'ana@exemplo.com')
  assert.ok(payload.subject.includes('confirmada'))
  assert.equal(payload.scheduled_at, undefined, 'confirmação sai agora, sem agendamento')
  const headers = sent[0].init.headers as Record<string, string>
  assert.equal(headers['Idempotency-Key'], 'email:confirmation:' + APPT)
  assert.ok(pool.updates.some(u => u.sql.includes("status = $2") && u.params.includes('resend-1')))
})

test('envio: lembrete dentro da janela vai com scheduled_at', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  const scheduledFor = new Date('2026-11-19T17:30:00.000Z').toISOString()
  await deliverMessage(deps(pool, fetcher), message({ kind: 'reminder_24h', scheduledFor }))
  assert.equal(JSON.parse(String(sent[0].init.body)).scheduled_at, scheduledFor)
})

test('envio: reunião cancelada não manda nada', async () => {
  const pool = fakePool({ meeting: { id: APPT, lead_id: 'l', full_name: 'Ana',
    email: 'ana@exemplo.com', whatsapp: null, starts_at: new Date('2026-11-20T17:30:00.000Z'),
    ends_at: new Date('2026-11-20T18:00:00.000Z'), meeting_url: null, status: 'cancelled' } })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await deliverMessage(deps(pool, fetcher), message()), false)
  assert.equal(sent.length, 0)
  assert.ok(pool.updates.some(u => u.sql.includes("status = 'skipped'") &&
    String(u.params[1]).includes('MEETING_NOT_ACTIVE')))
})

test('envio: lembrete nunca sai depois da hora da reunião', async () => {
  const pool = fakePool({ meeting: { id: APPT, lead_id: 'l', full_name: 'Ana', email: 'ana@exemplo.com',
    whatsapp: null, starts_at: new Date('2026-11-18T09:00:00.000Z'),
    ends_at: new Date('2026-11-18T09:30:00.000Z'), meeting_url: null, status: 'confirmed' } })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await deliverMessage(deps(pool, fetcher), message({ kind: 'reminder_1h' })), false)
  assert.equal(sent.length, 0)
  assert.ok(pool.updates.some(u => String(u.params[1]) === 'MEETING_ALREADY_STARTED'))
})

test('envio: franquia diária estourada bloqueia ANTES de chamar a Resend', async () => {
  const pool = fakePool({ usage: 100 })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await deliverMessage(deps(pool, fetcher), message()), false)
  assert.equal(sent.length, 0, 'nenhuma chamada à API: nada vira cobrança')
  assert.ok(pool.updates.some(u => String(u.params[1]) === 'DAILY_CAP'))
})

test('envio: canal desligado não chama a Resend', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  const off = emailConfig({ ready: false, apiKey: null })
  assert.equal(await deliverMessage(deps(pool, fetcher, off), message()), false)
  assert.equal(sent.length, 0)
})

test('envio: destinatário sem e-mail válido é pulado', async () => {
  const pool = fakePool({ meeting: { id: APPT, lead_id: 'l', full_name: 'Ana', email: null, whatsapp: null,
    starts_at: new Date('2026-11-20T17:30:00.000Z'), ends_at: new Date('2026-11-20T18:00:00.000Z'),
    meeting_url: null, status: 'confirmed' } })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await deliverMessage(deps(pool, fetcher), message()), false)
  assert.equal(sent.length, 0)
  assert.ok(pool.updates.some(u => String(u.params[1]) === 'INVALID_RECIPIENT'))
})

test('envio: erro 500 da Resend fica retriável; 422 encerra', async () => {
  for (const [status, retriable] of [[500, true], [422, false]] as const) {
    const pool = fakePool()
    const { fetcher } = fakeFetch(status, { message: 'erro' })
    assert.equal(await deliverMessage(deps(pool, fetcher), message()), false)
    const failure = pool.updates.find(u => u.sql.includes('CASE WHEN'))
    assert.ok(failure, 'marcou falha para ' + status)
    assert.equal(failure.params[2], retriable)
  }
})

test('agendamento: falha de banco nunca propaga para a confirmação da reunião', async () => {
  const explode: Queryable = { query: async () => { throw new Error('banco fora') } } as unknown as Queryable
  const { fetcher } = fakeFetch()
  const result = await scheduleMeetingEmails(deps(explode, fetcher), APPT)
  assert.deepEqual(result, { created: 0, delivered: 0 })
})

test('agendamento: com confirmação e lembretes desligados não toca no banco', async () => {
  const pool = fakePool()
  const { fetcher } = fakeFetch()
  const off = emailConfig({ confirmation: false, reminders: false })
  await scheduleMeetingEmails(deps(pool, fetcher, off), APPT)
  assert.equal(pool.calls.length, 0)
})

/* ------------------------------------------------------------- WhatsApp */

const whatsappConfig = (overrides: Partial<WhatsappConfig> = {}): WhatsappConfig => ({
  buttonReady: true, businessPhone: null, cloudReady: true, autoReply: true,
  verifyToken: 't', appSecret: 's', phoneNumberId: '123', accessToken: 'tok',
  freeTier: 1000, issues: [], ...overrides,
})

const incoming = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'wamid.1', from: '5531991234567', text: 'Referência: abcdefghjk',
  sentAt: new Date('2026-11-18T11:50:00.000Z'), ...overrides,
}) as Parameters<typeof handleIncomingMessage>[1]

function replyDeps(pool: Queryable, fetcher: SendDeps['fetch'], config = whatsappConfig()) {
  return { pool, config, fetch: fetcher, now: () => NOW, log: () => {} }
}

test('WhatsApp: conversa comum sem referência é ignorada (ninguém é respondido à toa)', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher), incoming({ text: 'oi, tudo bem?' })), 'no_reference')
  assert.equal(sent.length, 0)
  assert.equal(pool.calls.length, 0)
})

test('WhatsApp: remetente diferente do contato NÃO recebe os dados da reunião', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  const outcome = await handleIncomingMessage(replyDeps(pool, fetcher), incoming({ from: '5531988887777' }))
  assert.equal(outcome, 'sender_mismatch')
  assert.equal(sent.length, 0, 'o link do Meet não pode sair daqui')
})

test('WhatsApp: fora da janela de 24 h não responde (evitaria template pago)', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  const outcome = await handleIncomingMessage(replyDeps(pool, fetcher),
    incoming({ sentAt: new Date('2026-11-16T12:00:00.000Z') }))
  assert.equal(outcome, 'outside_service_window')
  assert.equal(sent.length, 0)
})

test('WhatsApp: resposta automática desligada recebe e registra, mas não responde', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch()
  const off = whatsappConfig({ autoReply: false })
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher, off), incoming()), 'auto_reply_off')
  assert.equal(sent.length, 0)
})

test('WhatsApp: franquia estourada não envia', async () => {
  const pool = fakePool({ usage: 1000 })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher), incoming()), 'quota_reached')
  assert.equal(sent.length, 0)
})

test('WhatsApp: a mesma reunião só recebe uma resposta automática', async () => {
  const pool = fakePool({ claimWhatsapp: false })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher), incoming()), 'already_replied')
  assert.equal(sent.length, 0)
})

test('WhatsApp: referência desconhecida ou vencida não leva a nada', async () => {
  const pool = fakePool({ reference: null })
  const { fetcher, sent } = fakeFetch()
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher), incoming()), 'unknown_reference')
  assert.equal(sent.length, 0)
})

test('WhatsApp: caminho completo responde com os dados reais e sem template pago', async () => {
  const pool = fakePool()
  const { fetcher, sent } = fakeFetch(200, { messages: [{ id: 'wamid.resp' }] })
  assert.equal(await handleIncomingMessage(replyDeps(pool, fetcher), incoming()), 'sent')
  assert.equal(sent.length, 1)
  assert.ok(sent[0].url.includes('/123/messages'))
  const payload = JSON.parse(String(sent[0].init.body))
  assert.equal(payload.type, 'text', 'texto livre, não template')
  assert.equal(payload.to, '5531991234567')
  assert.ok(payload.text.body.includes('https://meet.google.com/abc-defg-hij'))
  assert.ok(payload.text.body.includes('Ana'))
})
