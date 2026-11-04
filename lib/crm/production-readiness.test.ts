/**
 * Prontidão para Production (projeto Vercel cassiellos-crm) sem alterar o Preview (agencia-cassiellos).
 * Somente funções puras e dependências simuladas: nenhum acesso a banco, Meta, Google, Cloudflare ou push real.
 *
 * Cenários: 1) Preview inalterado · 2) Production reconhecida com integrações válidas · 3) Production recusa
 * segredos ausentes/inválidos · 4) CAPI off não envia · 5) push desligado não envia · 6) agendamento Google
 * desligado · 7) Production exige confirmação explícita e não aceita aliases do Preview.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crmEnvironmentLabel, crmRuntime, isCrmRuntimeEnabled, isCrmRuntimeRequest } from './runtime-env'
import { readPushEnv } from './push/config'
import { generateVapidKeys } from './push/web-push'
import { enqueueLeadNotification, enqueueMeetingNotifications, type PushDeps } from './push/store'
import { handlePushAdmin, type PushAdminDeps } from './push/admin-request'
import { bookingAccessConfig } from './booking-access'
import { authorizeAdminMutation } from './admin-actions'
import { handleFinanceAdmin, type FinanceAdminRequest } from './finance/admin-request'
import { getHomologationConfig } from '../marketing/homologation'
import { readCapiConfig, dispatchScheduleToMeta, type FetchLike as CapiFetch } from './meta-capi'
import { TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS, getTurnstileConfig, verifyTurnstileToken, type FetchLike } from './turnstile'
import { CRM_CANONICAL_ORIGIN, CRM_LEGACY_PREVIEW_ORIGIN, isAllowedOAuthRedirectHost, isCrmPreviewOrigin } from './preview-origins'

const VAPID = generateVapidKeys()
const PREVIEW = { VERCEL: '1', VERCEL_ENV: 'preview' }
const PRODUCTION = { VERCEL: '1', VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true' }
const SITE_PRODUCTION = { VERCEL: '1', VERCEL_ENV: 'production' } // site institucional (main) — sem a confirmação
const PUSH = { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'https://crm.cassiellos.com.br' }
const PIXEL = { META_PIXEL_ENABLED: 'true', META_PIXEL_ID: '28992534033707610', META_HOMOLOGATION_ENABLED: 'true' }
const TOKEN = 'EAAsyntheticTOKENvalue0123456789abcdef'
const noDb = { query: async () => { throw new Error('não deveria acessar o banco') } }
const ADMIN = { sessionValid: true, originAllowed: true, contentType: 'application/json' }

describe('política de ambientes do CRM (lib/crm/runtime-env.ts)', () => {
  it('Preview continua liberado; Production só com CRM_PRODUCTION_ENABLED=true exato', () => {
    assert.equal(crmRuntime(PREVIEW), 'preview')
    assert.equal(crmRuntime({ ...PREVIEW, CRM_PRODUCTION_ENABLED: 'true' }), 'preview')
    assert.equal(crmRuntime(PRODUCTION), 'production')
    for (const flag of [undefined, '', 'false', 'TRUE', '1', 'yes', 'on', ' true ', 'true\n']) {
      assert.equal(crmRuntime({ ...SITE_PRODUCTION, CRM_PRODUCTION_ENABLED: flag }), null, String(flag))
    }
    for (const vercelEnv of [undefined, '', 'development', 'Preview', 'PRODUCTION', 'staging', ' production']) {
      assert.equal(crmRuntime({ VERCEL_ENV: vercelEnv, CRM_PRODUCTION_ENABLED: 'true' }), null, String(vercelEnv))
    }
    assert.equal(isCrmRuntimeEnabled(SITE_PRODUCTION), false)
    assert.equal(isCrmRuntimeRequest({ vercelEnv: 'production' }), false)
    assert.equal(isCrmRuntimeRequest({ vercelEnv: 'production', crmProductionEnabled: 'true' }), true)
    assert.equal(isCrmRuntimeRequest({ vercelEnv: 'preview' }), true)
  })

  it('rótulo dos registros: production em Production, preview no Preview e fora da Vercel', () => {
    assert.equal(crmEnvironmentLabel(PRODUCTION), 'production')
    assert.equal(crmEnvironmentLabel(PREVIEW), 'preview')
    assert.equal(crmEnvironmentLabel({}), 'preview')
    assert.equal(crmEnvironmentLabel(SITE_PRODUCTION), 'preview')
  })
})

describe('Cenário 1 — Preview inalterado', () => {
  it('push, agendamento, homologação, origens e guardas administrativos como antes', () => {
    const push = readPushEnv({ ...PREVIEW, ...PUSH, PWA_PUSH_ENABLED: 'true' })
    assert.deepEqual([push.vapidReady, push.ready, push.issues], [true, true, []])
    assert.equal(bookingAccessConfig({ ...PREVIEW, CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }).enabled, true)
    assert.deepEqual(getHomologationConfig({ ...PREVIEW, ...PIXEL }), { pixelId: '28992534033707610' })
    assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN, 'preview'), true)
    assert.equal(isAllowedOAuthRedirectHost(new URL(CRM_LEGACY_PREVIEW_ORIGIN).hostname, 'preview'), true)
    assert.equal(authorizeAdminMutation({ vercelEnv: 'preview', ...ADMIN }), null)
  })
})

describe('Cenário 2 — Production reconhecida quando habilitada e válida', () => {
  it('push com VAPID válido + chave geral; agendamento com a chave; guardas administrativos liberados', () => {
    const push = readPushEnv({ ...PRODUCTION, ...PUSH, PWA_PUSH_ENABLED: 'true' })
    assert.deepEqual([push.vapidReady, push.ready, push.issues, push.publicKey], [true, true, [], VAPID.publicKey])
    assert.equal(bookingAccessConfig({ ...PRODUCTION, CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }).enabled, true)
    assert.equal(authorizeAdminMutation({ vercelEnv: 'production', crmProductionEnabled: 'true', ...ADMIN }), null)
    assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN, 'production'), true)
    assert.equal(isAllowedOAuthRedirectHost('crm.cassiellos.com.br', 'production'), true)
  })

  it('finanças: Production habilitada passa da guarda (e só então tenta o banco)', async () => {
    const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'production', ...ADMIN, actorRef: 'ref' }
    const pool = { connect: async () => { throw new Error('banco simulado indisponível') } }
    const deps = { pool, log: () => undefined, now: () => new Date('2026-11-04T15:00:00Z') }
    assert.equal((await handleFinanceAdmin(deps, base)).status, 404)
    assert.deepEqual(await handleFinanceAdmin(deps, { ...base, crmProductionEnabled: 'true' }), { status: 503, body: { error: 'FINANCE_UNAVAILABLE' } })
  })

  it('painel de notificações: Production habilitada responde; sem a confirmação, 404', async () => {
    const deps: PushAdminDeps = {
      pool: noDb, env: () => ({ ready: false, vapidReady: false, vapid: null }),
      envStatus: () => readPushEnv({ ...PRODUCTION, ...PUSH, PWA_PUSH_ENABLED: 'false' }),
      fetch: async () => { throw new Error('não deveria enviar') }, secret: 'k', audit: () => undefined,
    }
    const req = { method: 'POST' as const, ...ADMIN, rawBody: JSON.stringify({ action: 'nada' }), actorRef: 'abcdef0123456789' }
    assert.equal((await handlePushAdmin(deps, { ...req, vercelEnv: 'production' })).status, 404)
    assert.deepEqual(await handlePushAdmin(deps, { ...req, vercelEnv: 'production', crmProductionEnabled: 'true' }), { status: 400, body: { error: 'INVALID_ACTION' } })
  })
})

describe('Cenário 3 — Production recusa segredos ausentes ou inválidos', () => {
  it('VAPID ausente, par trocado (inclusive o par de outro projeto) ou subject inválido: sem inscrição nem envio', () => {
    const missing = readPushEnv({ ...PRODUCTION, PWA_PUSH_ENABLED: 'true' })
    assert.deepEqual([missing.vapidReady, missing.ready, missing.publicKey], [false, false, null])
    assert.ok(missing.issues.includes('VAPID_MISSING'))
    const otherProject = generateVapidKeys()
    const mixed = readPushEnv({ ...PRODUCTION, ...PUSH, VAPID_PRIVATE_KEY: otherProject.privateKey, PWA_PUSH_ENABLED: 'true' })
    assert.ok(mixed.issues.includes('VAPID_INVALID')); assert.equal(mixed.vapid, null)
    assert.ok(readPushEnv({ ...PRODUCTION, ...PUSH, VAPID_SUBJECT: 'crm' }).issues.includes('SUBJECT_INVALID'))
  })

  it('Turnstile: chaves ausentes ou de teste num deploy são recusadas', () => {
    assert.deepEqual(getTurnstileConfig({ ...PRODUCTION }), { status: 'missing' })
    assert.deepEqual(getTurnstileConfig({ ...PRODUCTION, NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.siteAlwaysPasses,
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.secretAlwaysPasses }), { status: 'test_keys_in_deployment' })
  })

  it('Turnstile: token emitido para um alias *.vercel.app não vale em Production (hostname_mismatch)', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({
      success: true, hostname: 'cassiellos-crm.vercel.app', action: TURNSTILE_BOOKING_ACTION, challenge_ts: new Date().toISOString(),
    }) })
    const r = await verifyTurnstileToken({ token: 'x'.repeat(40), secretKey: 'productionSecretKey_0123456789', fetchImpl,
      expectedAction: TURNSTILE_BOOKING_ACTION, expectedHostnames: [new URL(CRM_CANONICAL_ORIGIN).hostname] })
    assert.deepEqual(r.ok ? 'ok' : r.reason, 'hostname_mismatch')
  })

  it('Production SEM a confirmação explícita (ex.: produção do site institucional): CRM inexistente', async () => {
    const push = readPushEnv({ ...SITE_PRODUCTION, ...PUSH, PWA_PUSH_ENABLED: 'true' })
    assert.equal(push.ready, false); assert.ok(push.issues.includes('ENV_NOT_SUPPORTED'))
    assert.equal(bookingAccessConfig({ ...SITE_PRODUCTION, CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }).enabled, false)
    assert.equal(getHomologationConfig({ ...SITE_PRODUCTION, ...PIXEL }), null)
    assert.deepEqual(authorizeAdminMutation({ vercelEnv: 'production', ...ADMIN }), { status: 404, error: 'NOT_FOUND' })
  })
})

describe('Cenário 4 — Meta CAPI desligada não envia', () => {
  it('META_CAPI_MODE=off (ou ausente/desconhecido): configuração off e nenhuma chamada à Meta', async () => {
    for (const mode of ['off', undefined, '', 'LIVE', 'on']) {
      const config = readCapiConfig({ ...PRODUCTION, META_CAPI_MODE: mode, META_PIXEL_ID: '28992534033707610', META_CAPI_ACCESS_TOKEN: TOKEN })
      assert.equal(config.mode, 'off', String(mode))
      let calls = 0
      const fetch: CapiFetch = async () => { calls++; return { status: 200, json: async () => ({ events_received: 1 }) } }
      const store = new Proxy({}, { get: () => async () => { throw new Error('não deveria acessar a fila') } })
      const out = await dispatchScheduleToMeta({ config, store: store as never, fetch },
        { eventId: 'chronos_scheduled_' + 'a'.repeat(32), clientIp: '203.0.113.9', userAgent: 'agent' })
      assert.equal(out.status, 'skipped'); assert.equal(calls, 0)
    }
  })
})

describe('Cenário 5 — PWA_PUSH_ENABLED=false não envia avisos automáticos', () => {
  it('novo lead e reunião: not_ready, sem consulta ao banco nem envio', async () => {
    for (const flag of ['false', undefined]) {
      let sent = 0
      const deps: PushDeps = {
        pool: noDb, env: () => readPushEnv({ ...PRODUCTION, ...PUSH, PWA_PUSH_ENABLED: flag }),
        fetch: async () => { sent++; return { status: 201, headers: { get: () => null } } as never }, secret: 'k',
      }
      assert.equal((await enqueueLeadNotification(deps, '00000000-0000-4000-8000-000000000000')).outcome, 'not_ready')
      assert.equal((await enqueueMeetingNotifications(deps, {
        appointmentId: '00000000-0000-4000-8000-000000000001', bookingRequestId: '00000000-0000-4000-8000-000000000002',
      })).outcome, 'not_ready')
      assert.equal(sent, 0)
    }
  })
})

describe('Cenário 6 — CRM_GOOGLE_BOOKINGS_ENABLED=false não agenda no Google', () => {
  it('Production habilitada com a chave desligada ou ausente: confirmação desligada', () => {
    for (const flag of ['false', undefined, 'TRUE', '1']) {
      assert.equal(bookingAccessConfig({ ...PRODUCTION, CRM_GOOGLE_BOOKINGS_ENABLED: flag }).enabled, false, String(flag))
    }
  })
})

describe('Cenário 7 — Production não reaproveita aliases nem defaults do Preview', () => {
  it('origens e callback OAuth do Preview não valem em Production', () => {
    assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN, 'production'), false)
    assert.equal(isAllowedOAuthRedirectHost(new URL(CRM_LEGACY_PREVIEW_ORIGIN).hostname, 'production'), false)
    assert.equal(isAllowedOAuthRedirectHost('cassiellos-crm.vercel.app', 'production'), false)
  })
})

describe('caminho padrão das rotas (process.env), sem passar o ambiente explicitamente', () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const keys = ['VERCEL_ENV', 'CRM_PRODUCTION_ENABLED', 'CRM_GOOGLE_BOOKINGS_ENABLED']
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
    try {
      for (const k of keys) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
      fn()
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    }
  }

  it('Production habilitada: origens e callback restritos ao domínio definitivo; rótulo production', () => {
    withEnv({ VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true', CRM_GOOGLE_BOOKINGS_ENABLED: 'false' }, () => {
      assert.equal(isCrmRuntimeEnabled(), true)
      assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN), true)
      assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), false)
      assert.equal(isAllowedOAuthRedirectHost('cassiellos-crm.vercel.app'), false)
      assert.equal(crmEnvironmentLabel(), 'production')
      assert.equal(bookingAccessConfig().enabled, false)
    })
  })

  it('produção do site institucional (sem a confirmação): CRM desligado', () => {
    withEnv({ VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: undefined, CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }, () => {
      assert.equal(isCrmRuntimeEnabled(), false)
      assert.equal(bookingAccessConfig().enabled, false)
    })
  })

  it('Preview: lista original de origens e rótulo preview', () => {
    withEnv({ VERCEL_ENV: 'preview', CRM_PRODUCTION_ENABLED: undefined, CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }, () => {
      assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), true)
      assert.equal(crmEnvironmentLabel(), 'preview')
      assert.equal(bookingAccessConfig().enabled, true)
    })
  })
})
