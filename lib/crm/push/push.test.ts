/**
 * Etapa 5 — PWA + Web Push: testes unitários SEM rede e SEM banco.
 * Chaves e endpoints são gerados no próprio teste (fictícios).
 */
import assert from 'node:assert/strict'
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import {
  b64url, encryptWebPushPayload, generateVapidKeys, pushHostOf, sendWebPush, validVapidKeys, vapidAuthorization, type FetchLike,
} from './web-push'
import { decryptWebPushPayload } from './web-push-receiver'
import { publicPushEnv, readPushEnv } from './config'
import { NOTIFICATION_TEXT, buildPushPayload, receiptToken, validReceipt } from './messages'
import { confirmedMeetingFrom, newLeadFrom, queueThenDeliver } from './hooks'
import { SERVICE_WORKER_SOURCE } from './service-worker'
import { handlePushAdmin, type PushAdminDeps } from './admin-request'
import { safeCrmReturnPath } from '../return-path'
import { DEFAULT_WHATSAPP_TEMPLATE, renderWhatsappMessage, validateWhatsappTemplate, whatsappSendLink } from '../whatsapp-message'

const VAPID = generateVapidKeys()
const ENV = { VERCEL_ENV: 'preview', PWA_PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey }
const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = '99999999-2222-4333-8444-555555555555'

function subscriber() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
  const auth = randomBytes(16)
  return { ecdh, auth, target: { endpoint: 'https://fcm.googleapis.com/fcm/send/' + b64url.encode(randomBytes(12)), p256dh: b64url.encode(ecdh.getPublicKey()), auth: b64url.encode(auth) } }
}

describe('Web Push — protocolo nativo (RFC 8291 / RFC 8292)', () => {
  it('RFC 8291, apêndice A: reproduz exatamente o vetor de teste oficial', () => {
    const out = encryptWebPushPayload(Buffer.from('When I grow up, I want to be a watermelon'),
      b64url.decode('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
      b64url.decode('BTBZMqHH6r4Tts7J_aSIgg'),
      { senderPrivateKey: b64url.decode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: b64url.decode('DGv6ra1nlYgDCS1FRnbzlw') })
    assert.equal(b64url.encode(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
  })
  it('ida e volta com chaves aleatórias; conteúdo cifrado não aparece em claro', () => {
    const s = subscriber()
    const text = Buffer.from(JSON.stringify({ hello: 'mundo', n: 1 }))
    const body = encryptWebPushPayload(text, s.ecdh.getPublicKey(), s.auth)
    assert.ok(!body.includes(Buffer.from('mundo')))
    assert.deepEqual(decryptWebPushPayload(body, s.ecdh, s.auth), text)
    assert.throws(() => encryptWebPushPayload(text, Buffer.alloc(10), s.auth))
  })
  it('VAPID: JWT ES256 válido (aud = origem do serviço, exp ≤ 1 h, sub) e chaves conferidas', () => {
    const now = 1_800_000_000
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', VAPID, 'https://crm.cassiellos.com.br', now)
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    assert.ok(match)
    assert.deepEqual(JSON.parse(b64url.decode(match[1]).toString()), { typ: 'JWT', alg: 'ES256' })
    assert.deepEqual(JSON.parse(b64url.decode(match[2]).toString()), { aud: 'https://fcm.googleapis.com', exp: now + 3600, sub: 'https://crm.cassiellos.com.br' })
    assert.equal(match[4], VAPID.publicKey)
    const pub = b64url.decode(VAPID.publicKey)
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33)) }, format: 'jwk' })
    assert.equal(verify('sha256', Buffer.from(match[1] + '.' + match[2]), { key, dsaEncoding: 'ieee-p1363' }, b64url.decode(match[3])), true)
    assert.equal(validVapidKeys(VAPID), true)
    assert.equal(validVapidKeys({ publicKey: VAPID.publicKey, privateKey: generateVapidKeys().privateKey }), false)
  })
  it('somente serviços de push conhecidos (sem SSRF para endereços internos)', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QW', 'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(pushHostOf(ok), ok)
    for (const bad of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x',
      'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'javascript:alert(1)', 42])
      assert.equal(pushHostOf(bad), null, String(bad))
  })
  it('envio: cabeçalhos corretos e classificação honesta das respostas', async () => {
    const s = subscriber()
    const calls: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = []
    const reply = (status: number, retryAfter?: string): FetchLike => async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body })
      return { status, headers: { get: (n: string) => n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null } }
    }
    const v = { keys: VAPID, subject: 'https://crm.cassiellos.com.br' }
    assert.deepEqual(await sendWebPush(reply(201), s.target, { a: 1 }, v), { kind: 'accepted', status: 201 })
    const h = calls[0].headers
    assert.equal(h['Content-Encoding'], 'aes128gcm'); assert.equal(h.Urgency, 'high'); assert.equal(h.TTL, '43200')
    assert.ok(h.Authorization.startsWith('vapid t=')); assert.equal(calls[0].url, s.target.endpoint)
    assert.deepEqual(JSON.parse(decryptWebPushPayload(calls[0].body, s.ecdh, s.auth).toString()), { a: 1 })
    assert.deepEqual(await sendWebPush(reply(410), s.target, {}, v), { kind: 'gone', status: 410 })
    assert.deepEqual(await sendWebPush(reply(404), s.target, {}, v), { kind: 'gone', status: 404 })
    assert.deepEqual(await sendWebPush(reply(429, '7'), s.target, {}, v), { kind: 'retry', status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 })
    assert.equal((await sendWebPush(reply(503), s.target, {}, v)).kind, 'retry')
    assert.deepEqual(await sendWebPush(reply(403), s.target, {}, v), { kind: 'failed', status: 403, code: 'VAPID_REJECTED' })
    assert.deepEqual(await sendWebPush(reply(400), s.target, {}, v), { kind: 'failed', status: 400, code: 'PUSH_REJECTED_400' })
    assert.equal((await sendWebPush(async () => { throw new TypeError('fetch failed') }, s.target, {}, v)).kind, 'retry')
    const slow: FetchLike = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))))
    assert.deepEqual(await sendWebPush(slow, s.target, {}, v, { timeoutMs: 20 }), { kind: 'retry', status: null, code: 'TIMEOUT', retryAfterSeconds: 5 })
    assert.deepEqual(await sendWebPush(reply(201), { ...s.target, endpoint: 'https://evil.example/x' }, {}, v), { kind: 'failed', status: 0, code: 'ENDPOINT_NOT_ALLOWED' })
  })
})

describe('Web Push — configuração e privacidade do aviso', () => {
  it('desligado por padrão; VAPID libera teste e inscrição; chave geral libera os avisos automáticos', () => {
    for (const v of [undefined, 'false', 'TRUE', '1']) assert.equal(readPushEnv({ ...ENV, PWA_PUSH_ENABLED: v }).ready, false)
    const off = readPushEnv({ ...ENV, PWA_PUSH_ENABLED: 'false' })
    assert.equal(off.vapidReady, true); assert.equal(off.publicKey, VAPID.publicKey)
    assert.equal(readPushEnv(ENV).ready, true)
    assert.ok(readPushEnv({ ...ENV, VAPID_PRIVATE_KEY: '' }).issues.includes('VAPID_MISSING'))
    assert.ok(readPushEnv({ ...ENV, VAPID_PRIVATE_KEY: generateVapidKeys().privateKey }).issues.includes('VAPID_INVALID'))
    assert.ok(readPushEnv({ ...ENV, VAPID_SUBJECT: 'nada' }).issues.includes('SUBJECT_INVALID'))
    assert.equal(readPushEnv({ ...ENV, VERCEL_ENV: 'production' }).vapidReady, false)
    const shown = JSON.stringify(publicPushEnv(ENV))
    assert.ok(!shown.includes(VAPID.privateKey) && shown.includes(VAPID.publicKey))
  })
  it('payload mínimo: só tipo, título/texto genéricos, destino opaco, tag e recibo', () => {
    const p = buildPushPayload({ kind: 'meeting_whatsapp_ready', notificationId: UUID_A, deliveryId: UUID_B, secret: 's3cr3t' })
    assert.deepEqual(Object.keys(p).sort(), ['b', 'd', 'g', 'k', 'r', 't', 'u', 'v'])
    assert.equal(p.u, '/crm/notificacoes/abrir/' + UUID_A); assert.equal(p.g, UUID_A)
    assert.deepEqual([p.t, p.b], [NOTIFICATION_TEXT.meeting_whatsapp_ready.title, NOTIFICATION_TEXT.meeting_whatsapp_ready.body])
    assert.equal(NOTIFICATION_TEXT.lead_created.title, 'Novo lead | CRM | Cassiellos')
    assert.equal(NOTIFICATION_TEXT.lead_created.body, 'Um novo contato chegou pelo formulário. Toque para visualizar e atender no CRM.')
    assert.equal(NOTIFICATION_TEXT.meeting_confirmed.title, '🦈 NOVA REUNIÃO CONFIRMADA!')
    assert.equal(NOTIFICATION_TEXT.meeting_confirmed.body, 'Uma reunião foi agendada. Toque para visualizar os detalhes no CRM.')
    assert.equal(NOTIFICATION_TEXT.meeting_whatsapp_ready.title, '✅ CONFIRMAÇÃO PRONTA!')
    assert.equal(NOTIFICATION_TEXT.meeting_whatsapp_ready.body, 'A mensagem de confirmação para o cliente já está preparada. Toque para revisar e abrir o WhatsApp.')
    assert.ok(JSON.stringify(p).length < 600)
  })
  it('recibo: só com o token HMAC da própria entrega', () => {
    const t = receiptToken('s3cr3t', UUID_B)
    assert.equal(validReceipt('s3cr3t', UUID_B, t), true)
    assert.equal(validReceipt('s3cr3t', UUID_A, t), false)
    assert.equal(validReceipt('outro', UUID_B, t), false)
    assert.equal(validReceipt(undefined, UUID_B, t), false)
    assert.equal(validReceipt('s3cr3t', 'x', t), false)
    assert.equal(validReceipt('s3cr3t', UUID_B, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')), false)
  })
  it('retorno após login: só caminhos internos do CRM', () => {
    for (const ok of ['/crm', '/crm?lead=' + UUID_A, '/crm?view=notificacoes', '/crm/reuniao/' + UUID_A + '?whatsapp=1', '/crm/notificacoes/abrir/' + UUID_A])
      assert.equal(safeCrmReturnPath(ok), ok)
    for (const bad of ['//evil.example', 'https://evil.example', '/crm//evil', '/crmx', '/crm/login?next=/crm', '/crm\\evil', '/crm/<script>', '/agendar', null, 'x'.repeat(300)])
      assert.equal(safeCrmReturnPath(bad), null, String(bad))
  })
})

describe('Web Push — ganchos (somente eventos novos)', () => {
  it('lead: só 201 com reused=false', () => {
    assert.deepEqual(newLeadFrom({ status: 201, body: { ok: true, leadId: UUID_A, reused: false } }), { leadId: UUID_A })
    for (const r of [{ status: 200, body: { ok: true, leadId: UUID_A, reused: true } }, { status: 201, body: { ok: true, leadId: UUID_A, reused: true } },
      { status: 201, body: { ok: true, leadId: 'x', reused: false } }, { status: 400, body: { error: 'INVALID' } }, { status: 503, body: { error: 'LEAD_INTAKE_UNAVAILABLE' } },
      { status: 403, body: { error: 'SECURITY_CHECK_FAILED' } }]) assert.equal(newLeadFrom(r), null, JSON.stringify(r))
  })
  it('reunião: só 201 nova (Google + banco); reenvio idempotente, falha e bloqueio = nada', () => {
    const ok = { ok: true, appointmentId: UUID_A, bookingRequestId: UUID_B }
    assert.deepEqual(confirmedMeetingFrom({ status: 201, body: ok }), { appointmentId: UUID_A, bookingRequestId: UUID_B })
    for (const r of [{ status: 200, body: { ...ok, alreadyConfirmed: true } }, { status: 201, body: { ...ok, alreadyConfirmed: true } },
      { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }, { status: 503, body: { error: 'BOOKING_REQUIRES_REVIEW' } },
      { status: 403, body: { error: 'TEST_EMAIL_NOT_ALLOWED' } }]) assert.equal(confirmedMeetingFrom(r), null)
  })
  it('chave OFF = nada; erro/demora da fila nunca afetam a resposta; envio só depois', async () => {
    let enq = 0
    assert.equal(await queueThenDeliver({ x: 1 }, { switchReady: () => false, enqueue: async () => { enq++; return [] }, schedule: () => assert.fail(), deliver: async () => undefined }), false)
    assert.equal(enq, 0)
    const tasks: Array<() => Promise<void>> = []
    const delivered: string[][] = []
    assert.equal(await queueThenDeliver({ x: 1 }, { switchReady: () => true, enqueue: async () => ['n1', 'n2'], schedule: t => tasks.push(t),
      deliver: async ids => { delivered.push(ids) } }), true)
    assert.equal(delivered.length, 0, 'nada é enviado antes da resposta')
    await tasks[0](); assert.deepEqual(delivered, [['n1', 'n2']])
    // Fila lenta: a resposta segue após o prazo; o envio ainda acontece depois.
    const start = Date.now()
    const later: Array<() => Promise<void>> = []
    await queueThenDeliver({ x: 1 }, { switchReady: () => true, budgetMs: 30, enqueue: () => new Promise(r => setTimeout(() => r(['n3']), 80)),
      schedule: t => later.push(t), deliver: async ids => { delivered.push(ids) } })
    assert.ok(Date.now() - start < 70)
    await later[0](); assert.deepEqual(delivered.at(-1), ['n3'])
    const failing: Array<() => Promise<void>> = []
    assert.equal(await queueThenDeliver({ x: 1 }, { switchReady: () => true, enqueue: async () => { throw new Error('db down') },
      schedule: t => failing.push(t), deliver: async () => { throw new Error('push down') } }), true)
    await assert.doesNotReject(failing[0]())
  })
})

describe('WhatsApp — mensagem pronta (envio manual)', () => {
  const meeting = { name: 'Ana Fictícia Souza', company: 'Clínica Exemplo', startsAt: '2026-11-03T13:00:00.000Z', endsAt: '2026-11-03T13:30:00.000Z',
    meetingUrl: 'https://meet.google.com/abc-defg-hij', meetingName: 'Diagnóstico' }
  it('modelo padrão exatamente como pedido, com Brasília e primeiro nome', () => {
    assert.equal(renderWhatsappMessage(DEFAULT_WHATSAPP_TEMPLATE, meeting),
      'Olá, Ana! Tudo bem?\n\nSua reunião com a Cassiellos está confirmada para 03/11/2026, às 10:00.\n\nEste é o link da nossa reunião:\nhttps://meet.google.com/abc-defg-hij\n\nAté lá! 🦈')
  })
  it('link wa.me com número válido e texto codificado; número inválido = sem link', () => {
    const text = renderWhatsappMessage(DEFAULT_WHATSAPP_TEMPLATE, meeting)
    const r = whatsappSendLink('(31) 98765-4321', text)
    assert.ok(r.ok)
    if (r.ok) {
      assert.equal(r.url, 'https://wa.me/5531987654321?text=' + encodeURIComponent(text))
      assert.equal(decodeURIComponent(r.url.split('?text=')[1]), text)
    }
    assert.deepEqual(whatsappSendLink('123', text), { ok: false, reason: 'INVALID_WHATSAPP' })
    assert.deepEqual(whatsappSendLink('(31) 98765-4321', '   '), { ok: false, reason: 'EMPTY_TEXT' })
  })
  it('validação do modelo editável', () => {
    assert.deepEqual(validateWhatsappTemplate('Oi {senha}'), { ok: false, error: 'TEMPLATE_UNKNOWN_VARIABLE', detail: 'senha' })
    assert.deepEqual(validateWhatsappTemplate('x'.repeat(601)), { ok: false, error: 'TEMPLATE_TOO_LONG' })
    assert.deepEqual(validateWhatsappTemplate('  '), { ok: false, error: 'TEMPLATE_EMPTY' })
    assert.equal(validateWhatsappTemplate(DEFAULT_WHATSAPP_TEMPLATE).ok, true)
  })
})

describe('Service worker do PWA', () => {
  function load() {
    const handlers: Record<string, (e: unknown) => void> = {}
    const shown: Array<{ title: string; options: Record<string, unknown> }> = []
    const receipts: unknown[] = []
    const opened: string[] = []
    const self = {
      location: { origin: 'https://crm.cassiellos.com.br' },
      addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
      skipWaiting: () => undefined,
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }) } },
      clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => { opened.push(url) } },
    }
    const fetch = async (_url: string, init: { body: string }) => { receipts.push(JSON.parse(init.body)); return {} }
    vm.runInNewContext(SERVICE_WORKER_SOURCE, { self, fetch, URL, JSON, Promise })
    return { handlers, shown, receipts, opened }
  }
  async function fire(handler: (e: unknown) => void, event: Record<string, unknown>) {
    let waited: Promise<unknown> = Promise.resolve()
    handler({ ...event, waitUntil: (p: Promise<unknown>) => { waited = p } })
    await waited
  }
  it('sem evento fetch e sem cache: nenhuma resposta autenticada é guardada', () => {
    const { handlers } = load()
    assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'install', 'notificationclick', 'push'])
    assert.ok(!/caches\.|indexedDB|localStorage/.test(SERVICE_WORKER_SOURCE))
  })
  it('push → aviso genérico com tag; recibo "exibida"; toque → recibo e abertura da tela certa', async () => {
    const sw = load()
    const payload = buildPushPayload({ kind: 'meeting_confirmed', notificationId: UUID_A, deliveryId: UUID_B, secret: 'k' })
    await fire(sw.handlers.push, { data: { json: () => payload } })
    assert.equal(sw.shown[0].title, NOTIFICATION_TEXT.meeting_confirmed.title)
    assert.equal(sw.shown[0].options.tag, UUID_A)
    assert.equal(sw.shown[0].options.renotify, false)
    assert.deepEqual(sw.receipts[0], { d: UUID_B, r: payload.r, e: 'displayed' })
    const notification = { close: () => undefined, data: sw.shown[0].options.data }
    await fire(sw.handlers.notificationclick, { notification })
    assert.deepEqual(sw.opened, ['https://crm.cassiellos.com.br/crm/notificacoes/abrir/' + UUID_A])
    assert.equal((sw.receipts[1] as { e: string }).e, 'clicked')
  })
  it('payload estranho: título padrão e destino sempre dentro do CRM', async () => {
    const sw = load()
    await fire(sw.handlers.push, { data: { json: () => ({ t: 123, u: 'https://evil.example', g: 'x' }) } })
    await fire(sw.handlers.push, { data: { json: () => { throw new Error('bad') } } })
    assert.equal(sw.shown[0].title, 'CRM | Cassiellos')
    assert.equal((sw.shown[0].options.data as { url: string }).url, '/crm')
    await fire(sw.handlers.notificationclick, { notification: { close: () => undefined, data: { url: '//evil.example' } } })
    assert.deepEqual(sw.opened, ['https://crm.cassiellos.com.br/crm'])
  })
})

describe('Web Push — API administrativa (permissões)', () => {
  const deps: PushAdminDeps = {
    pool: { query: async () => { throw new Error('não deveria consultar o banco') } } as unknown as PushAdminDeps['pool'],
    env: () => readPushEnv({ ...ENV, VAPID_PUBLIC_KEY: '' }), envStatus: () => publicPushEnv({ ...ENV, VAPID_PUBLIC_KEY: '' }),
    fetch: async () => { throw new Error('não deveria enviar') }, secret: 'k', audit: () => undefined,
  }
  const base = { method: 'POST' as const, vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json',
    rawBody: JSON.stringify({ action: 'subscribe' }), actorRef: 'abcdef0123456789' }
  it('fora do Preview, sem sessão (visitante), origem externa ou corpo inválido = bloqueado', async () => {
    assert.equal((await handlePushAdmin(deps, { ...base, vercelEnv: 'production' })).status, 404)
    assert.equal((await handlePushAdmin(deps, { ...base, sessionValid: false })).status, 401)
    assert.equal((await handlePushAdmin(deps, { ...base, method: 'GET', sessionValid: false })).status, 401)
    assert.equal((await handlePushAdmin(deps, { ...base, originAllowed: false })).status, 403)
    assert.equal((await handlePushAdmin(deps, { ...base, contentType: 'text/plain' })).status, 400)
    assert.equal((await handlePushAdmin(deps, { ...base, rawBody: '[]' })).status, 400)
    assert.equal((await handlePushAdmin(deps, { ...base, rawBody: '{"action":"x"}' })).status, 400)
  })
  it('inscrição sem VAPID configurado = recusada; pré-visualização usa só dados fictícios', async () => {
    assert.deepEqual((await handlePushAdmin(deps, base)).body, { error: 'VAPID_NOT_READY' })
    const p = await handlePushAdmin(deps, { ...base, rawBody: JSON.stringify({ action: 'preview_template' }) })
    assert.equal(p.status, 200)
    assert.ok(String(p.body.text).startsWith('Olá, Maria! Tudo bem?'))
  })
})

describe('PWA — manifesto e ícones', () => {
  it('manifesto só da área /crm: nome, standalone, cores e ícones 192/512/maskable existentes', async () => {
    const { GET } = await import('../../../app/crm/manifest.webmanifest/route')
    const res = GET()
    assert.equal(res.headers.get('content-type'), 'application/manifest+json; charset=utf-8')
    const m = await res.json() as Record<string, unknown> & { icons: Array<{ src: string; sizes: string; purpose: string }> }
    assert.deepEqual([m.name, m.short_name, m.start_url, m.scope, m.display, m.theme_color, m.background_color, m.lang],
      ['CRM | Cassiellos', 'CRM | Cassiellos', '/crm', '/crm', 'standalone', '#07101F', '#07101F', 'pt-BR'])
    const { readFileSync } = await import('node:fs')
    for (const icon of [...m.icons, { src: '/crm-icons/apple-touch-icon.png', sizes: '180x180' }, { src: '/crm-icons/badge-96.png', sizes: '96x96' }]) {
      const png = readFileSync('public' + icon.src)
      assert.equal(png.subarray(1, 4).toString(), 'PNG', icon.src)
      assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes, icon.src)
    }
    assert.ok(m.icons.some(i => i.purpose === 'maskable'))
  })
})
