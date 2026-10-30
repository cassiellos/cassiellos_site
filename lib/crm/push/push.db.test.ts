/**
 * Etapa 5 — Web Push: integração contra PostgreSQL DESCARTÁVEL (migrações 0001–0010).
 * Pipeline real do cadastro e da confirmação (Turnstile e Google simulados) + fila + envio com o serviço
 * de push simulado. Cada "aparelho" tem chaves reais geradas no teste: o corpo enviado é DECIFRADO aqui
 * para provar o que chega ao celular (e o que nunca chega). Nada real é enviado; dados fictícios.
 */
import assert from 'node:assert/strict'
import { createECDH, randomBytes, randomUUID, type ECDH } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import { Pool } from 'pg'
import { getBookingForm } from '../booking-forms'
import { confirmBookingRequest, type BookingSession } from '../booking-confirmation'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from '../availability/engine'
import { saveLeadSubmission } from '../lead-intake'
import { readPushEnv } from './config'
import { confirmedMeetingFrom, newLeadFrom, queueThenDeliver } from './hooks'
import { NOTIFICATION_TEXT, type PushPayload } from './messages'
import {
  MAX_ATTEMPTS, changePushSettings, deliverAfterEvent, dispatchNotifications, enqueueLeadNotification, enqueueMeetingNotifications,
  enqueueTestNotification, listDevices, listHistory, loadPushSettings, recordReceipt, registerSubscription, resolveNotification,
  revokeSubscription, sweepPushQueue, type PushDeps,
} from './store'
import { b64url, generateVapidKeys, type FetchLike } from './web-push'
import { decryptWebPushPayload } from './web-push-receiver'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const HOST = 'crm.cassiellos.com.br'
const TEST_RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }
const VAPID = generateVapidKeys()
const ENV = { VERCEL_ENV: 'preview', PWA_PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey }
const SECRET = 'segredo-de-teste-para-recibos-0000000000'
const NAME = 'Beatriz Fictícia Lima'
const PHONE = '31991234567'
const MEET = 'https://meet.google.com/tst-abcd-efg'

type Device = { ecdh: ECDH; auth: Buffer; endpoint: string; id?: string }
type Sent = { endpoint: string; payload: PushPayload }

describe('Web Push — fila, ordem, aparelhos e privacidade (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  const logs: string[] = []
  const devices = new Map<string, Device>()
  before(async () => { pool = new Pool({ connectionString: url, max: 10 }) })
  after(async () => { await pool?.end() })
  beforeEach(async () => {
    // Banco descartável: cada teste começa sem aparelhos ativos e com preferências padrão.
    await pool.query("UPDATE crm.push_subscriptions SET status = 'revoked' WHERE status = 'active'")
    await pool.query("UPDATE crm.push_deliveries SET status = 'cancelled' WHERE status IN ('pending', 'retry', 'sending')")
    await pool.query('UPDATE crm.push_settings SET notify_leads = true, notify_meetings = true, whatsapp_template = NULL, last_test_at = NULL')
  })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows
  const email = (tag: string) => 'push.' + tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com'
  const elapse = async () => { await pool.query("UPDATE crm.push_deliveries SET next_attempt_at = now() WHERE status = 'retry'") }

  /** Serviço de push simulado: decifra o corpo com a chave do aparelho e responde conforme o roteiro. */
  function pushService(script: Record<string, Array<number | Error>> = {}) {
    const sent: Sent[] = []
    const fetch: FetchLike = async (endpoint, init) => {
      assert.ok(init.headers.Authorization.startsWith('vapid t='))
      assert.equal(init.headers['Content-Encoding'], 'aes128gcm')
      const queue = script[endpoint] ?? []
      const next = queue.length ? queue.shift()! : 201
      if (next instanceof Error) throw next
      const device = devices.get(endpoint)!
      if (next === 201) sent.push({ endpoint, payload: JSON.parse(decryptWebPushPayload(init.body, device.ecdh, device.auth).toString()) })
      return { status: next, headers: { get: () => null } }
    }
    return { fetch, sent }
  }
  const deps = (fetch: FetchLike, extra: Partial<PushDeps> = {}): PushDeps => ({
    pool, env: () => readPushEnv(ENV), fetch, secret: SECRET, sleep: elapse,
    log: (event, details) => { logs.push(JSON.stringify({ event, ...details })) }, ...extra,
  })

  async function addDevice(label: string): Promise<Device> {
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
    const device: Device = { ecdh, auth: randomBytes(16), endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID() }
    const r = await registerSubscription(pool, { endpoint: device.endpoint, p256dh: b64url.encode(ecdh.getPublicKey()), auth: b64url.encode(device.auth), label, actorRef: 'abcdef0123456789' })
    assert.ok(r.ok)
    device.id = r.ok ? r.id : undefined
    devices.set(device.endpoint, device)
    return device
  }

  async function newLead(address: string, opts: { isTest?: boolean; key?: string } = {}) {
    return saveLeadSubmission(pool, {
      idempotencyKey: opts.key ?? randomUUID(), name: NAME, email: address, phone: PHONE,
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Fictícia', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: opts.isTest ?? true, bookingMode: 'test',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: HOST, challengeTs: null },
      marketing: { consent: false, decided: true }, eventSourceUrl: ORIGIN + '/agendar/odontologia',
    })
  }
  /** Mesmo contrato da rota /api/booking/leads: 201 = novo cadastro/envio; 200 = reenvio idempotente. */
  const intakeResult = (r: Awaited<ReturnType<typeof newLead>>) => ({ status: r.reused ? 200 : 201, body: { ok: true, leadId: r.leadId, reused: r.reused } })

  async function runHook<T>(target: T | null, enqueue: (t: T) => Promise<string[]>, fetch: FetchLike) {
    const tasks: Array<() => Promise<void>> = []
    const used = await queueThenDeliver(target, { switchReady: () => readPushEnv(ENV).ready, enqueue, schedule: t => tasks.push(t),
      deliver: ids => deliverAfterEvent(deps(fetch), ids) })
    for (const t of tasks) await t()
    return used
  }

  async function confirm(address: string, opts: { failGoogle?: boolean; session?: BookingSession } = {}) {
    const s = opts.session ?? await (async () => { const l = await newLead(address); return { leadId: l.leadId, submissionId: l.submissionId, formSlug: 'odontologia' } })()
    const slot = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], TEST_RULES)).find(x => x.length)![0]
    const result = await confirmBookingRequest({
      pool, verifySession: () => s, getForm: getBookingForm, readBusy: async () => [],
      createEvent: async i => { if (opts.failGoogle) throw new Error('GOOGLE_DOWN'); return { id: 'evt' + i.requestId.replaceAll('-', ''), meetingUrl: MEET, htmlLink: null } },
      calendarId: 'cal-' + randomUUID(), allowedEmail: address, loadRules: async () => TEST_RULES,
    }, { bookingToken: 'x', startAt: slot.startAt, pageOrigin: ORIGIN })
    return { result, session: s }
  }

  it('novo lead → 1 aviso por aparelho, cifrado, genérico; tocar abre a ficha do lead', async () => {
    const a = await addDevice('iPhone · Safari'); const b = await addDevice('Android · Chrome')
    const svc = pushService()
    const lead = await newLead(email('lead'))
    assert.equal(await runHook(newLeadFrom(intakeResult(lead)), t => enqueueLeadNotification(deps(svc.fetch), t.leadId).then(r => r.ids), svc.fetch), true)
    assert.deepEqual(svc.sent.map(s => s.endpoint).sort(), [a.endpoint, b.endpoint].sort())
    const p = svc.sent[0].payload
    assert.deepEqual([p.k, p.t, p.b], ['lead_created', NOTIFICATION_TEXT.lead_created.title, NOTIFICATION_TEXT.lead_created.body])
    assert.equal(p.g, svc.sent[1].payload.g, 'mesmo aviso lógico nos dois aparelhos')
    assert.equal(await resolveNotification(pool, p.g), '/crm?lead=' + lead.leadId)
    assert.ok((await q("SELECT opened_at FROM crm.push_notifications WHERE id = $1", [p.g]))[0].opened_at)
  })

  it('duplicidades: reenvio idempotente, novo envio do mesmo lead, refresh e repetição = nenhum aviso extra', async () => {
    await addDevice('Celular')
    const svc = pushService()
    const address = email('dup')
    const key = randomUUID()
    const first = await newLead(address, { key })
    await runHook(newLeadFrom(intakeResult(first)), t => enqueueLeadNotification(deps(svc.fetch), t.leadId).then(r => r.ids), svc.fetch)
    const replay = await newLead(address, { key })
    assert.equal(replay.reused, true)
    assert.equal(newLeadFrom(intakeResult(replay)), null, 'reenvio idempotente (200) não dispara')
    const resubmission = await newLead(address)
    assert.equal(resubmission.leadId, first.leadId)
    assert.deepEqual(await enqueueLeadNotification(deps(svc.fetch), resubmission.leadId), { outcome: 'duplicate', ids: [] })
    assert.equal(svc.sent.length, 1)
    await pool.query("UPDATE crm.leads SET created_at = now() - interval '1 hour' WHERE id = $1", [first.leadId])
    const later = await newLead(email('old'))
    await pool.query("UPDATE crm.leads SET created_at = now() - interval '1 hour' WHERE id = $1", [later.leadId])
    assert.deepEqual(await enqueueLeadNotification(deps(svc.fetch), later.leadId), { outcome: 'not_eligible', ids: [] }, 'nada retroativo')
  })

  it('reunião confirmada → 2 avisos na ordem certa em cada aparelho; o 2 abre a mensagem do WhatsApp', async () => {
    const a = await addDevice('iPhone'); const b = await addDevice('Android')
    const svc = pushService()
    const address = email('meet')
    const { result } = await confirm(address)
    assert.equal(result.status, 201)
    assert.equal('push' in result.body, false)
    await runHook(confirmedMeetingFrom(result), t => enqueueMeetingNotifications(deps(svc.fetch), t).then(r => r.ids), svc.fetch)
    for (const d of [a, b]) {
      const mine = svc.sent.filter(s => s.endpoint === d.endpoint).map(s => s.payload.k)
      assert.deepEqual(mine, ['meeting_confirmed', 'meeting_whatsapp_ready'], 'ordem por aparelho')
    }
    const [first, second] = svc.sent.filter(s => s.endpoint === a.endpoint).map(s => s.payload)
    assert.deepEqual([first.t, second.t], [NOTIFICATION_TEXT.meeting_confirmed.title, NOTIFICATION_TEXT.meeting_whatsapp_ready.title])
    const appointmentId = result.body.appointmentId as string
    assert.equal(await resolveNotification(pool, first.g), '/crm/reuniao/' + appointmentId)
    assert.equal(await resolveNotification(pool, second.g), '/crm/reuniao/' + appointmentId + '?whatsapp=1')
    // Repetição da confirmação (refresh / clique duplo): 200 idempotente, nenhum aviso extra.
    const before = svc.sent.length
    assert.equal(confirmedMeetingFrom({ status: 200, body: { ok: true, alreadyConfirmed: true, bookingRequestId: result.body.bookingRequestId } }), null)
    assert.deepEqual(await enqueueMeetingNotifications(deps(svc.fetch), { appointmentId, bookingRequestId: result.body.bookingRequestId as string }),
      { outcome: 'duplicate', ids: [] })
    assert.equal(svc.sent.length, before)
  })

  it('Google falha: nenhuma reunião, nenhum aviso; serviço de push fora do ar não afeta a reunião', async () => {
    const d = await addDevice('Celular')
    const svc = pushService({ [d.endpoint]: Array.from({ length: 20 }, () => new TypeError('fetch failed')) })
    const failed = await confirm(email('google'), { failGoogle: true })
    assert.equal(failed.result.status, 503)
    assert.equal(confirmedMeetingFrom(failed.result), null)
    const { result } = await confirm(email('pushdown'))
    assert.equal(result.status, 201)
    await runHook(confirmedMeetingFrom(result), t => enqueueMeetingNotifications(deps(svc.fetch), t).then(r => r.ids), svc.fetch)
    const [row] = await q<{ a: string; b: string }>(`SELECT a.status AS a, r.status AS b FROM crm.appointments a JOIN crm.booking_requests r ON r.appointment_id = a.id WHERE a.id = $1`,
      [result.body.appointmentId])
    assert.deepEqual([row.a, row.b], ['confirmed', 'confirmed'])
    assert.equal(svc.sent.length, 0)
  })

  it('aparelho expirado (410): marcado como expirado, sem aviso 2 para ele; o outro aparelho recebe os dois', async () => {
    const gone = await addDevice('Antigo'); const ok = await addDevice('Novo')
    const svc = pushService({ [gone.endpoint]: [410] })
    const { result } = await confirm(email('gone'))
    await runHook(confirmedMeetingFrom(result), t => enqueueMeetingNotifications(deps(svc.fetch), t).then(r => r.ids), svc.fetch)
    assert.deepEqual(svc.sent.filter(s => s.endpoint === ok.endpoint).map(s => s.payload.k), ['meeting_confirmed', 'meeting_whatsapp_ready'])
    assert.equal(svc.sent.filter(s => s.endpoint === gone.endpoint).length, 0)
    const status = (await listDevices(pool)).find(d => d.id === gone.id)!.status
    assert.equal(status, 'expired')
    const rows = await q<{ status: string; last_error: string | null }>(
      `SELECT d.status, d.last_error FROM crm.push_deliveries d JOIN crm.push_notifications n ON n.id = d.notification_id
        WHERE d.subscription_id = $1 AND n.appointment_id = $2 ORDER BY n.sequence`, [gone.id, result.body.appointmentId])
    assert.deepEqual(rows.map(r => r.status), ['gone', 'cancelled'])
  })

  it('tentativas: 503 e rede são repetidos (com tag fixa); esgotadas = falha; 403 = aparelho precisa autorizar de novo', async () => {
    const d = await addDevice('Celular')
    const svc = pushService({ [d.endpoint]: [503] })
    const lead = await newLead(email('retry'))
    const ids = (await enqueueLeadNotification(deps(svc.fetch), lead.leadId)).ids
    await dispatchNotifications(deps(svc.fetch), ids)
    assert.equal(svc.sent.length, 1)
    assert.deepEqual((await q<{ attempts: number; status: string }>('SELECT attempts, status FROM crm.push_deliveries WHERE notification_id = $1', [ids[0]]))[0], { attempts: 2, status: 'accepted' })

    const net = pushService({ [d.endpoint]: Array.from({ length: 10 }, () => new TypeError('fetch failed')) })
    const lead2 = await newLead(email('net'))
    const ids2 = (await enqueueLeadNotification(deps(net.fetch), lead2.leadId)).ids
    await dispatchNotifications(deps(net.fetch), ids2, { inlineRetries: 0 })
    for (let i = 0; i < MAX_ATTEMPTS; i++) { await elapse(); await sweepPushQueue(deps(net.fetch)) }
    assert.deepEqual((await q<{ attempts: number; status: string; last_error: string }>('SELECT attempts, status, last_error FROM crm.push_deliveries WHERE notification_id = $1', [ids2[0]]))[0],
      { attempts: MAX_ATTEMPTS, status: 'failed', last_error: 'MAX_ATTEMPTS_NETWORK_ERROR' })

    const rejected = await addDevice('Chave antiga')
    const svc403 = pushService({ [rejected.endpoint]: [403] })
    const lead3 = await newLead(email('vapid'))
    await dispatchNotifications(deps(svc403.fetch), (await enqueueLeadNotification(deps(svc403.fetch), lead3.leadId)).ids)
    assert.equal((await listDevices(pool)).find(x => x.id === rejected.id)!.status, 'rejected')
  })

  it('concorrência: três processamentos simultâneos = cada aviso uma única vez por aparelho', async () => {
    await addDevice('Celular')
    const svc = pushService()
    const slow: FetchLike = async (u, i) => { await new Promise(r => setTimeout(r, 25)); return svc.fetch(u, i) }
    const { result } = await confirm(email('race'))
    const ids = (await enqueueMeetingNotifications(deps(slow), confirmedMeetingFrom(result)!)).ids
    await Promise.all([dispatchNotifications(deps(slow), ids), dispatchNotifications(deps(slow), ids), sweepPushQueue(deps(slow))])
    await dispatchNotifications(deps(slow), ids)
    assert.deepEqual(svc.sent.map(s => s.payload.k).sort(), ['meeting_confirmed', 'meeting_whatsapp_ready'])
  })

  it('cancelamento e nada retroativo: reunião cancelada não envia; entregas com mais de 24 h vencem', async () => {
    await addDevice('Celular')
    const svc = pushService()
    const { result } = await confirm(email('cancel'))
    const target = confirmedMeetingFrom(result)!
    const ids = (await enqueueMeetingNotifications(deps(svc.fetch), target)).ids
    await pool.query("UPDATE crm.appointments SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [target.appointmentId])
    await dispatchNotifications(deps(svc.fetch), ids)
    assert.equal(svc.sent.length, 0)
    assert.deepEqual((await q<{ last_error: string }>(`SELECT d.last_error FROM crm.push_deliveries d JOIN crm.push_notifications n ON n.id = d.notification_id
      WHERE n.appointment_id = $1 ORDER BY n.sequence`, [target.appointmentId])).map(r => r.last_error), ['MEETING_CANCELLED', 'PREVIOUS_NOT_DELIVERED'])
    assert.deepEqual(await enqueueMeetingNotifications(deps(svc.fetch), target), { outcome: 'not_eligible', ids: [] })

    const lead = await newLead(email('expire'))
    const ids2 = (await enqueueLeadNotification(deps(svc.fetch), lead.leadId)).ids
    await pool.query("UPDATE crm.push_notifications SET created_at = now() - interval '25 hours' WHERE id = $1", [ids2[0]])
    await sweepPushQueue(deps(svc.fetch))
    assert.equal((await q<{ last_error: string }>('SELECT last_error FROM crm.push_deliveries WHERE notification_id = $1', [ids2[0]]))[0].last_error, 'EXPIRED')
    assert.equal(svc.sent.length, 0)
  })

  it('aparelhos: só os ativos recebem; revogado deixa de receber; preferências desligam cada tipo', async () => {
    const a = await addDevice('A'); const b = await addDevice('B')
    assert.equal(await revokeSubscription(pool, { id: b.id }), true)
    const svc = pushService()
    const lead = await newLead(email('multi'))
    await dispatchNotifications(deps(svc.fetch), (await enqueueLeadNotification(deps(svc.fetch), lead.leadId)).ids)
    assert.deepEqual(svc.sent.map(s => s.endpoint), [a.endpoint])
    await changePushSettings(pool, { action: 'preferences', notifyLeads: false, notifyMeetings: true }, 'x')
    assert.deepEqual(await enqueueLeadNotification(deps(svc.fetch), (await newLead(email('pref'))).leadId), { outcome: 'disabled', ids: [] })
    assert.deepEqual(await registerSubscription(pool, { endpoint: 'https://evil.example/x', p256dh: 'x', auth: 'y', label: 'x', actorRef: 'x' }),
      { ok: false, error: 'ENDPOINT_NOT_ALLOWED' })
  })

  it('chave geral OFF: nenhuma consulta ao banco; migração ausente: nada é tentado', async () => {
    let queries = 0
    const spy = { query: (...args: unknown[]) => { queries++; return (pool.query as (...a: unknown[]) => unknown)(...args) } } as unknown as Pool
    const off = () => readPushEnv({ ...ENV, PWA_PUSH_ENABLED: 'false' })
    const svc = pushService()
    assert.deepEqual(await enqueueLeadNotification({ ...deps(svc.fetch), pool: spy, env: off }, randomUUID()), { outcome: 'not_ready', ids: [] })
    assert.equal(queries, 0)
    const missing = { query: async (sql: string, p?: unknown[]) => sql.includes('to_regclass') ? { rows: [{ ok: false }], rowCount: 1 } : pool.query(sql, p) } as unknown as Pool
    assert.deepEqual(await enqueueLeadNotification({ ...deps(svc.fetch), pool: missing }, randomUUID()), { outcome: 'migration_pending', ids: [] })
    assert.equal(await loadPushSettings(missing), null)
  })

  it('teste manual: funciona com a chave geral OFF (só VAPID), intervalo mínimo, abre o painel', async () => {
    const d = await addDevice('Celular')
    const svc = pushService()
    const off = () => readPushEnv({ ...ENV, PWA_PUSH_ENABLED: 'false' })
    const t = await enqueueTestNotification({ ...deps(svc.fetch), env: off }, {})
    assert.ok(t.ok)
    if (t.ok) await dispatchNotifications({ ...deps(svc.fetch), env: off }, t.ids)
    assert.deepEqual(svc.sent.map(s => [s.endpoint, s.payload.k]), [[d.endpoint, 'test']])
    assert.equal(await resolveNotification(pool, svc.sent[0].payload.g), '/crm?view=notificacoes')
    assert.deepEqual(await enqueueTestNotification({ ...deps(svc.fetch), env: off }, {}), { ok: false, error: 'TEST_TOO_SOON' })
    const noVapid = () => readPushEnv({ ...ENV, VAPID_PRIVATE_KEY: '' })
    assert.deepEqual(await enqueueTestNotification({ ...deps(svc.fetch), env: noVapid }, {}), { ok: false, error: 'VAPID_NOT_READY' })
    // Avisos automáticos continuam bloqueados com a chave OFF, mesmo com aparelho ativo.
    assert.deepEqual(await enqueueLeadNotification({ ...deps(svc.fetch), env: off }, (await newLead(email('off'))).leadId), { outcome: 'not_ready', ids: [] })
  })

  it('recibos: exibida/aberta só para entrega aceita, uma vez; histórico distingue aceita ≠ exibida ≠ aberta', async () => {
    await addDevice('Celular')
    const svc = pushService()
    const lead = await newLead(email('receipt'))
    const ids = (await enqueueLeadNotification(deps(svc.fetch), lead.leadId)).ids
    await dispatchNotifications(deps(svc.fetch), ids)
    const deliveryId = svc.sent[0].payload.d
    let h = (await listHistory(pool)).find(x => x.id === ids[0])!
    assert.deepEqual([h.deliveries.accepted, h.deliveries.displayed, h.deliveries.clicked], [1, 0, 0])
    assert.equal(await recordReceipt(pool, deliveryId, 'displayed'), true)
    assert.equal(await recordReceipt(pool, deliveryId, 'clicked'), true)
    h = (await listHistory(pool)).find(x => x.id === ids[0])!
    assert.deepEqual([h.deliveries.accepted, h.deliveries.displayed, h.deliveries.clicked], [1, 1, 1])
    assert.equal(await recordReceipt(pool, randomUUID(), 'displayed'), false)
    assert.equal(await resolveNotification(pool, 'nao-e-uuid'), '/crm')
    assert.equal(await resolveNotification(pool, randomUUID()), '/crm')
  })

  it('modelo do WhatsApp: salvar, rejeitar variável desconhecida, restaurar', async () => {
    assert.deepEqual(await changePushSettings(pool, { action: 'save_template', template: 'Oi {senha}' }, 'x'), { ok: false, error: 'TEMPLATE_UNKNOWN_VARIABLE', detail: 'senha' })
    await changePushSettings(pool, { action: 'save_template', template: 'Oi {primeiro_nome}, até {data} às {horario}! {link_meet}' }, 'x')
    assert.equal((await loadPushSettings(pool))!.templateCustomized, true)
    await changePushSettings(pool, { action: 'restore_template' }, 'x')
    assert.equal((await loadPushSettings(pool))!.templateCustomized, false)
  })

  it('privacidade: nenhum dado pessoal nos avisos decifrados, nas tabelas de push nem nos logs', async () => {
    await addDevice('Celular')
    const svc = pushService()
    const lead = await newLead(email('privacy'))
    await runHook(newLeadFrom(intakeResult(lead)), t => enqueueLeadNotification(deps(svc.fetch), t.leadId).then(r => r.ids), svc.fetch)
    const { result } = await confirm(email('privacy2'))
    await runHook(confirmedMeetingFrom(result), t => enqueueMeetingNotifications(deps(svc.fetch), t).then(r => r.ids), svc.fetch)
    assert.ok(svc.sent.length >= 3)
    const payloads = JSON.stringify(svc.sent.map(s => s.payload))
    const tables = JSON.stringify([await q('SELECT * FROM crm.push_notifications'), await q('SELECT * FROM crm.push_deliveries'), await q('SELECT * FROM crm.push_settings'),
      await listHistory(pool), await listDevices(pool)])
    for (const secret of [NAME, 'Beatriz', PHONE, '99123-4567', 'Clínica Fictícia', MEET, 'meet.google.com', '@exemplo.com', 'Até R$', VAPID.privateKey, SECRET]) {
      assert.ok(!payloads.includes(secret), 'aviso contém ' + secret)
      assert.ok(!tables.includes(secret), 'tabelas de push contêm ' + secret)
      assert.ok(!logs.join('\n').includes(secret), 'log contém ' + secret)
    }
    for (const s of svc.sent) assert.deepEqual(Object.keys(s.payload).sort(), ['b', 'd', 'g', 'k', 'r', 't', 'u', 'v'])
    assert.ok(!JSON.stringify(await listDevices(pool)).includes('fcm.googleapis.com/fcm/send/'), 'painel não expõe o endpoint completo')
  })
})
