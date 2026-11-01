/**
 * Fase 2.2A — receptor de webhook: tudo que é recusado ANTES do banco (o pool simulado falha se for tocado) e
 * barreiras estáticas da fase (sem rota pública, sem rede, sem URL de produção, notificações desligadas).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { FinancePool } from '../finance/store'
import { FAKE_PII, FAKE_WEBHOOK_TOKEN, paymentFixture, webhookEvent } from './fixtures'
import { assertNoPaidNotifications, buildCustomerPayload, parseWebhookEvent, verifyWebhookToken } from './policy'
import { handleAsaasWebhook, MAX_WEBHOOK_BODY_BYTES, type WebhookLogEntry, type WebhookRequest } from './webhook'

const untouchable: FinancePool = { connect: async () => { throw new Error('o banco não pode ser tocado antes da autenticação') } }
const cfg = { environment: 'sandbox' as const, enabled: true, expectedToken: FAKE_WEBHOOK_TOKEN }
const body = JSON.stringify(webhookEvent('evt_puro0001', 'PAYMENT_RECEIVED', paymentFixture('pay_puro0001', null, { status: 'RECEIVED' })))
const req = (o: Partial<WebhookRequest> = {}): WebhookRequest => ({ method: 'POST', token: FAKE_WEBHOOK_TOKEN, contentType: 'application/json', rawBody: body, ...o })

describe('webhook — recusas antes do banco', () => {
  it('desativado (padrão): 404, mesmo com token correto', async () => {
    assert.equal((await handleAsaasWebhook({ environment: 'sandbox', expectedToken: FAKE_WEBHOOK_TOKEN }, { pool: untouchable }, req())).status, 404)
  })
  it('método diferente de POST: 405', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ method }))).status, 405)
  })
  it('sem token, token errado, token com 1 caractere a mais/menos, token fraco configurado: 401', async () => {
    const logs: WebhookLogEntry[] = []
    for (const token of [null, undefined, '', 'errado', FAKE_WEBHOOK_TOKEN + 'x', FAKE_WEBHOOK_TOKEN.slice(1), FAKE_WEBHOOK_TOKEN.toUpperCase()]) {
      const r = await handleAsaasWebhook(cfg, { pool: untouchable, log: e => logs.push(e) }, req({ token }))
      assert.deepEqual(r, { status: 401, body: { error: 'UNAUTHORIZED' } })
    }
    for (const expectedToken of [null, '', 'curto-demais']) {
      assert.equal((await handleAsaasWebhook({ ...cfg, expectedToken }, { pool: untouchable }, req({ token: expectedToken }))).status, 401)
    }
    assert.ok(logs.every(l => l.outcome === 'unauthorized' && Object.keys(l).length === 2), 'registro mínimo')
  })
  it('content-type, tamanho, JSON e evento inválidos: 415/413/400 sem tocar o banco', async () => {
    assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ contentType: 'text/plain' }))).status, 415)
    assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ rawBody: 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1) }))).status, 413)
    assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ rawBody: '{nao json' }))).status, 400)
    assert.deepEqual((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ rawBody: JSON.stringify({ id: 'x', event: 'PAYMENT_RECEIVED' }) }))).body, { error: 'INVALID_EVENT_ID' })
    assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ rawBody: JSON.stringify(webhookEvent('evt_1', 'PAYMENT_RECEIVED', { id: 'pay_x1', value: -1, dueDate: '2026-11-30' })) }))).status, 400)
    assert.equal((await handleAsaasWebhook(cfg, { pool: untouchable }, req({ contentType: 'application/json; charset=utf-8', rawBody: '[]' }))).status, 400)
  })
  it('verificação do token é em tempo constante sobre o hash (comprimentos diferentes não lançam)', () => {
    assert.equal(verifyWebhookToken('a', FAKE_WEBHOOK_TOKEN), false)
    assert.equal(verifyWebhookToken(FAKE_WEBHOOK_TOKEN, FAKE_WEBHOOK_TOKEN), true)
    assert.equal(verifyWebhookToken('x'.repeat(513), 'x'.repeat(513)), false)
  })
  it('payload mínimo: nenhum dado pessoal sobrevive à leitura do evento', () => {
    const ev = parseWebhookEvent('sandbox', JSON.parse(body))
    const text = JSON.stringify(ev)
    for (const v of Object.values(FAKE_PII)) assert.ok(!text.includes(v), v)
    assert.ok(!text.includes('invoiceUrl') && !text.includes('description'))
  })
})

describe('política de notificações (notificationDisabled: true)', () => {
  it('cliente novo sempre com notificações desligadas e sem canal de contato', () => {
    const p = buildCustomerPayload({ name: 'Cliente Fictício', cpfCnpj: '000.000.000-00'.replace(/0/g, '1'), externalReference: '00000000-0000-4000-8000-000000000001' })
    assert.equal(p.notificationDisabled, true)
    for (const k of ['email', 'mobilePhone', 'phone', 'address']) assert.ok(!(k in p), k)
  })
  it('qualquer carga que ligue e-mail, SMS, WhatsApp, voz ou Correios é recusada (inclusive aninhada)', () => {
    const forbidden = [{ notificationDisabled: false }, { emailEnabledForCustomer: true }, { smsEnabledForCustomer: true },
      { whatsappEnabledForCustomer: true }, { phoneCallEnabledForCustomer: true }, { postalService: true }, { enabled: true },
      { notifications: [{ event: 'PAYMENT_CREATED', smsEnabledForProvider: true }] }, { customer: { notificationDisabled: false } }]
    for (const f of forbidden) assert.throws(() => assertNoPaidNotifications(f), JSON.stringify(f))
    assert.doesNotThrow(() => assertNoPaidNotifications({ notificationDisabled: true, emailEnabledForCustomer: false, postalService: false }))
  })
})

describe('barreiras estáticas da Fase 2.2A', () => {
  const root = join(__dirname, '..', '..', '..')
  const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? (f === 'node_modules' || f.startsWith('.') ? [] : files(p)) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
  const asaasDir = join(root, 'lib', 'crm', 'asaas')
  const prod = files(asaasDir).filter(f => !/\.test\.ts$|fixtures\.ts$|test-support\.ts$/.test(f))

  it('nenhum arquivo de app/, components/ ou fora do módulo importa a integração Asaas (sem endpoint público)', () => {
    const importers = [...files(join(root, 'app')), ...files(join(root, 'lib')).filter(f => !f.startsWith(asaasDir))]
      .filter(f => /from ['"][^'"]*asaas[^'"]*['"]/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(importers, [])
  })
  it('módulo sem fetch global, sem process.env e sem URL de produção; rede SÓ no transporte HTTPS do Sandbox', () => {
    for (const f of prod) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      assert.ok(!/\bfetch\s*\(|globalThis\.fetch|XMLHttpRequest|undici|node:net|node:tls|node:http2/.test(src), 'rede em ' + f)
      if (!f.endsWith('transport-https.ts')) assert.ok(!/['"]node:https?['"]/.test(src), 'rede em ' + f)
      else assert.ok(!/api\.asaas\.com|hostname:\s*['"]/.test(src), 'host fixo deve vir da base do Sandbox')
      assert.ok(!/process\.env/.test(src), 'process.env em ' + f)
      assert.ok(!/api\.asaas\.com|www\.asaas\.com/.test(src), 'URL de produção em ' + f)
    }
  })
  it('transporte HTTPS, credencial e consulta só são importados pelo script do titular', () => {
    const importers = files(join(root, 'scripts')).filter(f => /from ['"][^'"]*asaas\/(transport-https|credential|probe)['"]/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(importers.map(f => f.slice(root.length + 1)), ['scripts/asaas-sandbox-probe.ts'])
    const inLib = files(asaasDir).filter(f => !/\.test\.ts$/.test(f) && !f.endsWith('probe.ts') && /from ['"]\.\/(transport-https|credential)['"]/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(inLib, [])
  })
  it('nenhum método de escrita no cliente HTTP (somente GET)', () => {
    const src = readFileSync(join(asaasDir, 'http.ts'), 'utf8')
    assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(src))
    assert.match(src, /method: 'GET'/)
  })
})
