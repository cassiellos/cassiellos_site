/**
 * Modo de homologação isolada (branch `crm-homolog`, somente Preview): a porta única e cada ponto que ela governa.
 * Tudo com valores FICTÍCIOS; nenhuma rede, nenhum banco.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { bookingAccessConfig } from './booking-access'
import { getCrmBookingMode } from './booking-mode'
import { crmAllowedOrigins, isCrmPreviewOrigin, CRM_CANONICAL_ORIGIN, CRM_LEGACY_PREVIEW_ORIGIN } from './preview-origins'
import { homologMode, crmDatabaseUrl, isHomologActive, realIntegrationsEnabled } from './homolog-mode'
import { simulatedBusyIntervals, simulatedCreateEvent } from './homolog-calendar'
import { crmRuntime, isCrmRuntimeRequest } from './runtime-env'
import { TURNSTILE_BOOKING_ACTION, TURNSTILE_TEST_KEYS as K, getTurnstileConfig, verifyTurnstileToken, type FetchLike } from './turnstile'

const BRANCH_HOST = 'agencia-cassiellos-git-crm-homolog-cassiellos-projects.vercel.app'
const DEPLOY_HOST = 'agencia-cassiellos-k3j9x2-cassiellos-projects.vercel.app'
const HOMOLOG_DB = 'postgresql://homolog_user:segredo-ficticio-1@ep-homolog-ficticio.example.com/homolog_db?sslmode=require'
const REAL_DB = 'postgresql://crm_user:segredo-ficticio-2@ep-crm-ficticio.example.com/neondb?sslmode=require'

const ACTIVE = {
  VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'crm-homolog',
  VERCEL_BRANCH_URL: BRANCH_HOST, VERCEL_URL: DEPLOY_HOST,
  CRM_HOMOLOG_MODE: 'true', CRM_HOMOLOG_DATABASE_URL: HOMOLOG_DB, CRM_DATABASE_URL: REAL_DB,
}
const reason = (env: Record<string, string | undefined>) => {
  const state = homologMode(env)
  return state.active ? 'active' : state.reason
}

describe('porta única: o modo só liga com TODAS as condições', () => {
  it('ativo: origens confirmadas pela Vercel (branch alias + deploy), nada presumido', () => {
    const state = homologMode(ACTIVE)
    assert.equal(state.active, true)
    if (state.active) {
      assert.deepEqual([...state.origins].sort(), ['https://' + BRANCH_HOST, 'https://' + DEPLOY_HOST].sort())
      assert.deepEqual([...state.hostnames].sort(), [BRANCH_HOST, DEPLOY_HOST].sort())
    }
  })

  it('basta uma origem confirmada pela Vercel (só o alias da branch OU só o deploy)', () => {
    assert.equal(reason({ ...ACTIVE, VERCEL_URL: undefined }), 'active')
    assert.equal(reason({ ...ACTIVE, VERCEL_BRANCH_URL: undefined }), 'active')
  })

  it('sem a confirmação explícita CRM_HOMOLOG_MODE=true (valor exato) fica inativo', () => {
    for (const value of [undefined, '', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
      assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_MODE: value }), 'not_requested', String(value))
    }
  })

  it('NUNCA em Production nem fora da Vercel, mesmo com todo o resto correto', () => {
    for (const env of [
      { ...ACTIVE, VERCEL_ENV: 'production' }, { ...ACTIVE, VERCEL_ENV: 'development' }, { ...ACTIVE, VERCEL_ENV: undefined },
      { ...ACTIVE, VERCEL_ENV: 'Preview' }, { ...ACTIVE, VERCEL: undefined }, { ...ACTIVE, VERCEL: '0' },
      { ...ACTIVE, VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true' },
    ]) assert.equal(reason(env), 'not_vercel_preview', JSON.stringify([env.VERCEL, env.VERCEL_ENV]))
  })

  it('somente a branch exata crm-homolog; qualquer outra (inclusive a do CRM atual e a main) fica inativa', () => {
    for (const ref of [undefined, '', 'main', 'feature/mini-crm-shark-scale', 'design-formulario', 'crm-homolog-2', 'crm-homolog/x',
      'CRM-HOMOLOG', 'Crm-Homolog', ' crm-homolog', 'crm-homolog ', 'xcrm-homolog', 'homolog'])
      assert.equal(reason({ ...ACTIVE, VERCEL_GIT_COMMIT_REF: ref }), 'wrong_branch', String(ref))
  })

  it('banco de homologação ausente, vazio ou inválido: inativo; nunca cai em CRM_DATABASE_URL', () => {
    for (const value of [undefined, '', '   ', 'isto não é uma URL'])
      assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: value }), 'database_missing', String(value))
    assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: undefined, CRM_DATABASE_URL: REAL_DB }), 'database_missing')
  })

  it('banco de homologação igual ao do CRM (mesmo host e banco) é recusado, ainda que usuário/senha/parâmetros mudem', () => {
    assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: REAL_DB }), 'database_shared')
    assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: 'postgresql://outro:outra@EP-CRM-FICTICIO.example.com/neondb?sslmode=disable' }), 'database_shared')
    // Mesmo servidor, OUTRO banco: é um destino diferente.
    assert.equal(reason({ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: 'postgresql://a:b@ep-crm-ficticio.example.com/homolog_db' }), 'active')
    // Sem banco do CRM definido no deploy de homologação: tudo bem.
    assert.equal(reason({ ...ACTIVE, CRM_DATABASE_URL: undefined }), 'active')
  })

  it('origem não confirmada pela Vercel: inativo (sem URL presumida, sem host de terceiros)', () => {
    for (const env of [
      { VERCEL_BRANCH_URL: undefined, VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: '', VERCEL_URL: '  ' },
      { VERCEL_BRANCH_URL: 'crm.cassiellos.com.br', VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: 'evil.example.com', VERCEL_URL: 'vercel.app.evil.com' },
      { VERCEL_BRANCH_URL: 'https://' + BRANCH_HOST, VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: BRANCH_HOST + ':8443', VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: BRANCH_HOST + '/caminho', VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: 'user@' + BRANCH_HOST, VERCEL_URL: undefined },
      { VERCEL_BRANCH_URL: '.vercel.app', VERCEL_URL: 'vercel.app' },
    ]) assert.equal(reason({ ...ACTIVE, ...env }), 'origin_unconfirmed', JSON.stringify(env))
  })

  it('qualquer integração real ligada por variável desativa o modo e informa só os NOMES', () => {
    const cases: [Record<string, string>, string][] = [
      [{ CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }, 'CRM_GOOGLE_BOOKINGS_ENABLED'],
      [{ PWA_PUSH_ENABLED: 'true' }, 'PWA_PUSH_ENABLED'],
      [{ META_PIXEL_ENABLED: 'true' }, 'META_PIXEL_ENABLED'],
      [{ META_HOMOLOGATION_ENABLED: 'true' }, 'META_HOMOLOGATION_ENABLED'],
      [{ META_CHRONOS_LIVE_ENABLED: 'true' }, 'META_CHRONOS_LIVE_ENABLED'],
      [{ META_CAPI_MODE: 'live' }, 'META_CAPI_MODE'],
      [{ META_CAPI_MODE: 'test' }, 'META_CAPI_MODE'],
    ]
    for (const [extra, name] of cases) {
      const state = homologMode({ ...ACTIVE, ...extra })
      assert.equal(state.active, false, name)
      if (!state.active) { assert.equal(state.reason, 'real_integration_enabled'); assert.deepEqual(state.blockedBy, [name]) }
    }
    // Desligadas explicitamente (como a documentação manda manter): continua ativo.
    assert.equal(reason({ ...ACTIVE, CRM_GOOGLE_BOOKINGS_ENABLED: 'false', PWA_PUSH_ENABLED: 'false', META_PIXEL_ENABLED: 'false',
      META_HOMOLOGATION_ENABLED: 'false', META_CHRONOS_LIVE_ENABLED: 'false', META_CAPI_MODE: 'off' }), 'active')
    assert.deepEqual(realIntegrationsEnabled({ ...ACTIVE, META_CAPI_MODE: 'off' }), [])
  })

  it('o motivo nunca carrega valores de variáveis (segredos, URLs de banco)', () => {
    for (const env of [{ ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: REAL_DB }, { ...ACTIVE, META_CAPI_MODE: 'live' }, { ...ACTIVE, VERCEL_ENV: 'production' }]) {
      const text = JSON.stringify(homologMode(env))
      for (const secret of ['segredo-ficticio', 'ep-crm-ficticio', 'ep-homolog-ficticio', 'crm_user', 'homolog_user']) assert.equal(text.includes(secret), false, secret)
    }
  })

  it('nenhuma URL do Preview é presumida no código do modo', () => {
    const source = readFileSync(new URL('./homolog-mode.ts', import.meta.url), 'utf8')
    assert.equal(/https?:\/\/[^\s'"`]*vercel\.app/i.test(source), false)
    assert.equal(/agencia-cassiellos-git/i.test(source), false)
  })
})

describe('política de ambiente: a branch crm-homolog nunca cai no Preview normal nem em Production', () => {
  it('crm-homolog sem o modo completo: o CRM inteiro responde 404 (nada de banco do CRM)', () => {
    for (const env of [
      { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'crm-homolog' },
      { ...ACTIVE, CRM_HOMOLOG_MODE: undefined },
      { ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: REAL_DB },
      { ...ACTIVE, META_CAPI_MODE: 'live' },
    ]) assert.equal(crmRuntime(env), null)
  })

  it('crm-homolog em Production nunca liga o CRM, nem com CRM_PRODUCTION_ENABLED=true', () => {
    assert.equal(crmRuntime({ ...ACTIVE, VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true' }), null)
    assert.equal(crmRuntime({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'crm-homolog', CRM_PRODUCTION_ENABLED: 'true' }), null)
  })

  it('crm-homolog com o modo completo: Preview', () => {
    assert.equal(crmRuntime(ACTIVE), 'preview')
  })

  it('outras branches: comportamento anterior preservado (Preview liga; Production exige a confirmação)', () => {
    assert.equal(crmRuntime({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/mini-crm-shark-scale' }), 'preview')
    assert.equal(crmRuntime({ VERCEL_ENV: 'preview' }), 'preview')
    assert.equal(crmRuntime({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), null)
    assert.equal(crmRuntime({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', CRM_PRODUCTION_ENABLED: 'true' }), 'production')
    // CRM_HOMOLOG_MODE em outra branch ou em Production é ignorado.
    assert.equal(crmRuntime({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', CRM_HOMOLOG_MODE: 'true' }), null)
  })

  it('rotas administrativas (finance/push/ações) recebem as chaves e aplicam a mesma política', () => {
    const request = (env: Record<string, string | undefined>) => ({ vercelEnv: env.VERCEL_ENV, crmProductionEnabled: env.CRM_PRODUCTION_ENABLED, homologEnv: env })
    assert.equal(isCrmRuntimeRequest(request(ACTIVE)), true)
    assert.equal(isCrmRuntimeRequest(request({ ...ACTIVE, CRM_HOMOLOG_MODE: undefined })), false)
    assert.equal(isCrmRuntimeRequest({ vercelEnv: 'preview', crmProductionEnabled: undefined }), true) // chamadas antigas continuam valendo
  })
})

describe('banco: em homologação só o banco de homologação', () => {
  it('ativo: CRM_HOMOLOG_DATABASE_URL; inativo: CRM_DATABASE_URL como sempre', () => {
    assert.equal(crmDatabaseUrl(ACTIVE), HOMOLOG_DB)
    assert.equal(crmDatabaseUrl({ ...ACTIVE, CRM_HOMOLOG_MODE: undefined }), REAL_DB)
    assert.equal(crmDatabaseUrl({ VERCEL_ENV: 'production', CRM_DATABASE_URL: REAL_DB, CRM_HOMOLOG_DATABASE_URL: HOMOLOG_DB, CRM_HOMOLOG_MODE: 'true' }), REAL_DB)
    assert.equal(crmDatabaseUrl({ CRM_DATABASE_URL: REAL_DB }), REAL_DB)
  })
})

describe('Turnstile: chaves oficiais de teste só na homologação ativa', () => {
  const TEST = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: K.siteAlwaysPasses, TURNSTILE_SECRET_KEY: K.secretAlwaysPasses }
  const REAL = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAreal-site-key-ficticia', TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal-secret-key-ficticia-xx' }

  it('homologação ativa + chaves de teste: pronto', () => {
    assert.deepEqual(getTurnstileConfig({ ...ACTIVE, ...TEST }), { status: 'ready', siteKey: K.siteAlwaysPasses, secretKey: K.secretAlwaysPasses, usingTestKeys: true })
  })

  it('homologação ativa + chaves reais (ou mistura): recusado; nenhuma chave real na homologação', () => {
    assert.deepEqual(getTurnstileConfig({ ...ACTIVE, ...REAL }), { status: 'invalid' })
    assert.deepEqual(getTurnstileConfig({ ...ACTIVE, NEXT_PUBLIC_TURNSTILE_SITE_KEY: K.siteAlwaysPasses, TURNSTILE_SECRET_KEY: REAL.TURNSTILE_SECRET_KEY }), { status: 'invalid' })
    assert.deepEqual(getTurnstileConfig({ ...ACTIVE, NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL.NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY: K.secretAlwaysPasses }), { status: 'invalid' })
  })

  it('sem o modo ativo, chaves de teste continuam recusadas em QUALQUER deploy (Production inclusive)', () => {
    for (const env of [
      { ...ACTIVE, CRM_HOMOLOG_MODE: undefined }, { ...ACTIVE, VERCEL_ENV: 'production' }, { ...ACTIVE, VERCEL_GIT_COMMIT_REF: 'main' },
      { ...ACTIVE, VERCEL_ENV: 'production', CRM_PRODUCTION_ENABLED: 'true' }, { ...ACTIVE, META_CAPI_MODE: 'live' },
      { ...ACTIVE, CRM_HOMOLOG_DATABASE_URL: REAL_DB }, { VERCEL: '1', VERCEL_ENV: 'preview' },
    ]) assert.deepEqual(getTurnstileConfig({ ...env, ...TEST }), { status: 'test_keys_in_deployment' })
  })

  it('local (fora da Vercel) segue como antes: chaves de teste permitidas', () => {
    assert.equal(getTurnstileConfig(TEST).status, 'ready')
  })

  const siteverify = (data: Record<string, unknown>): FetchLike => async (_url, init) => {
    const body = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => (body.secret === K.secretAlwaysPasses && body.response === K.dummyToken
      ? { success: true, challenge_ts: new Date().toISOString(), ...data } : { success: false, 'error-codes': ['invalid-input-response'] }) }
  }
  const verify = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => verifyTurnstileToken({
    token: K.dummyToken, secretKey: K.secretAlwaysPasses, expectedAction: TURNSTILE_BOOKING_ACTION,
    expectedHostnames: ['localhost', BRANCH_HOST], fetchImpl: siteverify(data), ...extra,
  })

  it('Siteverify de teste (action "test"): aceito só com o alias, e devolvido como a action esperada', async () => {
    const data = { hostname: 'localhost', action: 'test' }
    assert.deepEqual(await verify(data), { ok: false, reason: 'action_mismatch', codes: [] })
    const ok = await verify(data, { acceptedActionAliases: ['test'] })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.action, TURNSTILE_BOOKING_ACTION)
  })

  it('o alias não afrouxa nada além dele: outra action continua recusada; hostname continua conferido', async () => {
    assert.equal((await verify({ hostname: 'localhost', action: 'outra' }, { acceptedActionAliases: ['test'] })).ok, false)
    assert.deepEqual(await verify({ hostname: 'evil.example.com', action: 'test' }, { acceptedActionAliases: ['test'] }), { ok: false, reason: 'hostname_mismatch', codes: [] })
    assert.equal((await verify({ hostname: 'localhost', action: TURNSTILE_BOOKING_ACTION })).ok, true)
  })
})

describe('origens aceitas (CSRF): só as confirmadas pela Vercel neste deploy', () => {
  const KEYS = Object.keys(ACTIVE).concat(['CRM_PRODUCTION_ENABLED', 'CRM_BOOKING_MODE', 'CRM_GOOGLE_BOOKINGS_ENABLED'])
  function withProcessEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
    try {
      for (const k of KEYS) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
      fn()
    } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    }
  }

  it('ativo: o domínio real do CRM e os aliases antigos NÃO valem; os hosts confirmados valem', () => {
    withProcessEnv(ACTIVE, () => {
      assert.equal(isHomologActive(), true)
      assert.deepEqual([...crmAllowedOrigins()].sort(), ['https://' + BRANCH_HOST, 'https://' + DEPLOY_HOST].sort())
      assert.equal(isCrmPreviewOrigin('https://' + BRANCH_HOST), true)
      assert.equal(isCrmPreviewOrigin('https://' + DEPLOY_HOST), true)
      assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN), false)
      assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), false)
      assert.equal(isCrmPreviewOrigin('https://evil.example.com'), false)
      assert.equal(isCrmPreviewOrigin(null), false)
    })
  })

  it('inativo: listas anteriores, sem alteração', () => {
    withProcessEnv({}, () => {
      assert.equal(isCrmPreviewOrigin(CRM_CANONICAL_ORIGIN), true)
      assert.equal(isCrmPreviewOrigin('https://' + BRANCH_HOST), false)
    })
    withProcessEnv({ ...ACTIVE, CRM_HOMOLOG_MODE: undefined, VERCEL_GIT_COMMIT_REF: 'feature/mini-crm-shark-scale' }, () => {
      assert.equal(isCrmPreviewOrigin(CRM_LEGACY_PREVIEW_ORIGIN), true)
      assert.equal(isCrmPreviewOrigin('https://' + BRANCH_HOST), false)
    })
  })

  it('reserva em teste e agenda simulada: sem restrição por e-mail, sem convite', () => {
    withProcessEnv({ ...ACTIVE, CRM_BOOKING_MODE: 'live' }, () => assert.equal(getCrmBookingMode(), 'test'))
    withProcessEnv({ CRM_BOOKING_MODE: 'live' }, () => assert.equal(getCrmBookingMode(), 'live'))
    assert.deepEqual(bookingAccessConfig(ACTIVE), { enabled: true, restrictedToAllowedEmail: false, allowedEmail: '', sendInvites: false })
    // Fora do modo nada muda: Preview sem a chave do Google continua desligado; Production nunca liga.
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'preview' }).enabled, false)
    assert.equal(bookingAccessConfig({ ...ACTIVE, CRM_HOMOLOG_MODE: undefined }).enabled, false)
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'production', CRM_HOMOLOG_MODE: 'true', CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }).enabled, false)
  })
})

describe('agenda simulada: sem Google, sem rede, sem e-mail', () => {
  it('nenhum horário ocupado e evento apenas local; nenhuma chamada de rede', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls++; throw new Error('rede proibida na agenda simulada') }) as typeof fetch
    try {
      assert.deepEqual(await simulatedBusyIntervals(), [])
      const event = await simulatedCreateEvent({ requestId: '11111111-2222-3333-4444-555555555555' } as Parameters<typeof simulatedCreateEvent>[0])
      assert.deepEqual(event, { id: 'homolog11111111222233334444555555555555', meetingUrl: null, htmlLink: null, invitationRequested: false })
    } finally { globalThis.fetch = realFetch }
    assert.equal(calls, 0)
  })

  it('o Google real é desligado de forma estrutural no modo (OAuth/agenda) e as rotas escolhem a agenda simulada', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(read('./google-oauth.ts'), /export function googleOAuthConfig\(\)[^{]*\{\s*\/\/[^\n]*\n\s*if \(isHomologActive\(\)\) return null/)
    assert.match(read('../../app/api/booking/availability/route.ts'), /isHomologActive\(\) \? await simulatedBusyIntervals\(\)/)
    const confirm = read('../../app/api/booking/confirm/route.ts')
    assert.match(confirm, /readBusy: isHomologActive\(\) \? simulatedBusyIntervals : readGoogleBusyIntervals/)
    assert.match(confirm, /createEvent: isHomologActive\(\) \? simulatedCreateEvent : createGoogleBooking/)
  })
})
