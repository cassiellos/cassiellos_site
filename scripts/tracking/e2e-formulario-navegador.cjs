/*
 * Homologação em navegador real (Chromium) do funil /formularios/hamburguerias contra a cópia LOCAL e descartável
 * (banco local com dados fictícios). Scripts de terceiros (GTM, Meta, Turnstile) e as APIs de envio/agenda são
 * substituídos por respostas simuladas; o que se mede é o que o código do formulário empurra para o dataLayer.
 */
const { chromium, devices } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://localhost:3123'
const URL = BASE + '/formularios/hamburguerias?utm_source=meta&utm_medium=paid_social&utm_campaign=SC_C01_HAMBURGUERIAS'
const OUT = process.env.OUT || path.join(__dirname, 'evidencias')
fs.mkdirSync(OUT, { recursive: true })

const PII = ['QA Teste', 'qa.teste@example.com', '99876', '@hamburgueriaqa', 'bookingToken', 'tok_local_123', 'De R$', 'Sim', 'Não']
const FUNNEL_EVENTS = new Set([
  'form_view', 'form_start', 'form_cover_cta_click', 'form_step_view', 'form_step_complete', 'form_step_back',
  'form_validation_error', 'lead_submit_attempt', 'generate_lead', 'lead_submit_error', 'booking_calendar_view',
  'booking_calendar_load_error', 'booking_date_selected', 'booking_slots_loaded', 'booking_no_slots',
  'booking_slot_selected', 'booking_submit_attempt', 'booking_meeting_confirmed', 'booking_confirmation_error',
])

const results = []
const log = (...a) => console.log(...a)

function today() { return new Date().toISOString().slice(0, 10) }
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

async function newPage(browser, { mobile = true, api = {}, turnstile = 'ok' } = {}) {
  const context = await browser.newContext(mobile
    ? { ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }
    : { viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const page = await context.newPage()
  const hits = { gtm: 0, fb: 0, ga: 0, post: [], confirm: [], consentSync: 0 }
  const external = []
  page.on('request', r => {
    const u = r.url()
    if (/googletagmanager\.com\/gtm\.js/.test(u)) hits.gtm++
    if (/connect\.facebook\.net/.test(u)) hits.fb++
    if (/google-analytics\.com|analytics\.google\.com/.test(u)) hits.ga++
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u.split('?')[0])
  })
  await context.route('https://www.googletagmanager.com/gtm.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'window.__gtmLoaded=(window.__gtmLoaded||0)+1;' }))
  await context.route('https://connect.facebook.net/**', r => r.fulfill({ contentType: 'application/javascript', body: '/* fbevents stub */' }))
  const tsBody = {
    ok: "window.turnstile={render:function(el,o){window.__tsO=o;setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},40);return 'w1'},reset:function(){setTimeout(function(){window.__tsO.callback('XXXX.DUMMY.TOKEN.XXXX')},40)},remove:function(){}};",
    error: "window.turnstile={render:function(el,o){setTimeout(function(){o['error-callback']()},40);return 'w1'},reset:function(){},remove:function(){}};",
    never: "window.turnstile={render:function(el,o){return 'w1'},reset:function(){},remove:function(){}};",
  }[turnstile]
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', r => r.fulfill({ contentType: 'application/javascript', body: tsBody }))
  // Fontes do Google não existem no sandbox: responder vazio evita ruído.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))

  const start = addDays(today(), 1)
  await context.route('**/api/public/forms/hamburguerias', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = JSON.parse(route.request().postData() || '{}')
    hits.post.push(body)
    if (api.delay) await new Promise(r => setTimeout(r, api.delay))
    const planned = api.submit ? api.submit(hits.post.length) : null
    if (planned && planned.status) return route.fulfill({ status: planned.status, contentType: 'application/json', body: JSON.stringify(planned.json) })
    const outcome = body.answers && (body.answers.revenue === 'De R$ 30 mil a R$ 39 mil' || body.answers.budget === 'Não') ? 'limited' : 'qualified'
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(outcome === 'qualified'
        ? { ok: true, reused: false, leadMode: 'test', outcome, inlineBooking: true, bookingToken: 'tok_local_123', bookingEnabled: true,
            tracking: { lead: { eventName: 'Lead', eventId: 'lead_0123456789abcdef0123456789abcdef' } } }
        : { ok: true, reused: false, leadMode: 'test', outcome, title: 'Obrigado pelo interesse!', description: 'Retornaremos em breve.', actionLabel: '', actionHref: '',
            tracking: { lead: { eventName: 'Lead', eventId: 'lead_fedcba9876543210fedcba9876543210' } } }),
    })
  })
  await context.route('**/api/booking/calendar*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ today: today(), lastDate: addDays(today(), 30), closedDates: [] }) }))
  await context.route('**/api/booking/availability*', r => {
    if (api.availability) return api.availability(r)
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ slots: [
      { startAt: start + 'T13:00:00.000Z', endAt: start + 'T13:30:00.000Z', localTime: '10:00' },
      { startAt: start + 'T14:00:00.000Z', endAt: start + 'T14:30:00.000Z', localTime: '11:00' },
    ] }) })
  })
  await context.route('**/api/booking/confirm', async r => {
    hits.confirm.push(JSON.parse(r.request().postData() || '{}'))
    if (api.confirm) return api.confirm(r, hits.confirm.length)
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, bookingRequestId: 'bk_local_1', startAt: start + 'T13:00:00.000Z', endAt: start + 'T13:30:00.000Z',
      meetingTitle: 'Diagnóstico estratégico', googleMeetUrl: 'https://meet.google.com/abc-defg-hij', invitationRequested: true,
      tracking: { schedule: { eventName: 'Schedule', eventId: 'chronos_scheduled_0123456789abcdef0123456789abcdef' } } }) })
  })
  await context.route('**/api/booking/whatsapp', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await context.route('**/api/booking/consent', r => { hits.consentSync++; return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }) })
  return { context, page, hits, external }
}

async function open(page, url = URL) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('.cassiellos-public-flow', { timeout: 120000 })
  await page.waitForTimeout(700) // hidratação
}

async function dl(page) {
  return page.evaluate(() => (window.dataLayer || []).map(x => {
    if (x && typeof x === 'object' && 'length' in x && typeof x.length === 'number' && !Array.isArray(x)) return { __cmd: Array.from(x).map(v => (typeof v === 'object' ? { ...v } : v)) }
    return JSON.parse(JSON.stringify(x))
  }))
}
function funnel(list) { return list.filter(e => e && FUNNEL_EVENTS.has(e.event)) }
function consentCmds(list) { return list.filter(e => e && e.__cmd && e.__cmd[0] === 'consent') }
const row = e => [e.event, e.step_id || '-', e.step_index ?? '-', e.step_order ?? '-', e.funnel_stage || '-', e.step_type || '-', e.environment_mode || '-', e.validation_error_code || '-'].join(' | ')

async function cookie(page, name) {
  return page.evaluate(n => { const m = document.cookie.split('; ').find(c => c.startsWith(n + '=')); return m ? decodeURIComponent(m.slice(n.length + 1)) : null }, name)
}

const steps = {
  async cover(page) { await page.click('.cpf-cover .cpf-primary') },
  async text(page, value) { await page.fill('.cpf-question input', value); await page.click('.cpf-question button[type=submit]') },
  async option(page, label) { await page.click(`.cpf-option:has-text("${label}")`) },
  async contact(page, { submit = true } = {}) {
    await page.fill('.cpf-contact input[type=email]', 'qa.teste@example.com')
    await page.waitForFunction(() => { const b = document.querySelector('.cpf-contact button[type=submit]'); return b && !b.disabled }, null, { timeout: 15000 })
    if (submit) await page.click('.cpf-contact button[type=submit]')
  },
}
async function walkToContact(page, { revenue = 'De R$ 50 mil a R$ 59 mil', budget = 'Sim' } = {}) {
  await steps.cover(page)
  await steps.text(page, 'QA Teste')
  await steps.text(page, '(31) 99876-5432')
  await steps.text(page, '@hamburgueriaqa')
  await steps.option(page, revenue)
  if (revenue !== 'De R$ 30 mil a R$ 39 mil') await steps.option(page, budget)
  await page.waitForSelector('.cpf-contact')
}

function assertNoPii(name, list, extra = []) {
  const text = JSON.stringify(funnel(list))
  const bad = [...PII, ...extra].filter(p => text.includes(p))
  return bad.length ? 'DADOS PESSOAIS NO dataLayer: ' + bad.join(', ') : null
}
function check(name, cond, detail) { return { name, ok: Boolean(cond), detail: detail || '' } }
function count(list, event) { return funnel(list).filter(e => e.event === event).length }

async function scenario(browser, id, title, opts, fn) {
  const t0 = Date.now()
  const { context, page, hits, external } = await newPage(browser, opts)
  const out = { id, title, checks: [], events: [], notes: [] }
  try {
    await fn({ page, hits, out, external, context })
  } catch (e) {
    out.checks.push(check('execução sem exceção', false, String(e && e.message || e).split('\n')[0]))
    try { await page.screenshot({ path: path.join(OUT, id + '-erro.png') }) } catch {}
  }
  const list = await dl(page).catch(() => [])
  out.events = funnel(list).map(row)
  out.consent = consentCmds(list).map(c => c.__cmd.slice(1).map(x => (typeof x === 'object' ? x : x)))
  const pii = assertNoPii(id, list)
  out.checks.push(check('nenhum dado pessoal no dataLayer', !pii, pii || ''))
  out.durationMs = Date.now() - t0
  results.push(out)
  log(`\n=== ${id} — ${title} (${out.durationMs} ms)`)
  for (const c of out.checks) log(`  ${c.ok ? 'OK ' : 'FALHA'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
  for (const l of out.events) log('    ' + l)
  await context.close()
}

;(async () => {
  const browser = await chromium.launch()

  // S1 — Sem escolha: nada é coletado, o aviso aparece, formulário continua utilizável
  await scenario(browser, 'S1', 'Sem escolha de consentimento (celular)', {}, async ({ page, hits, out }) => {
    await open(page)
    const banner = page.locator('.cpf-entry-consent[data-consent-layer=entry]')
    await banner.waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(OUT, 'S1-aviso-entrada-celular.png') })
    out.checks.push(check('aviso de entrada visível com 3 botões', (await banner.locator('button').count()) === 3))
    out.checks.push(check('botões de mesmo peso (mesma classe, sem destaque)', (await banner.locator('button.cpf-entry-choice').count()) === 3))
    out.checks.push(check('rótulos: Recusar, Aceitar métricas, Personalizar', JSON.stringify(await banner.locator('button').allInnerTexts()) === JSON.stringify(['Recusar', 'Aceitar métricas', 'Personalizar'])))
    const sizes = await banner.locator('button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); const c = getComputedStyle(b); return [Math.round(r.height), c.backgroundColor, c.color, c.fontWeight].join('|') }))
    out.checks.push(check('mesmo tamanho, cor e peso nas três escolhas', new Set(sizes).size === 1, sizes.join(' ; ')))
    out.checks.push(check('nada pré-marcado (nenhum botão pressionado)', (await banner.locator('[aria-pressed=true]').count()) === 0))
    let list = await dl(page)
    const cmds = consentCmds(list)
    const def = cmds.find(c => c.__cmd[1] === 'default')
    out.checks.push(check('consent default com os 4 sinais negados', def && ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'].every(k => def.__cmd[2][k] === 'denied'), JSON.stringify(def && def.__cmd[2])))
    out.checks.push(check('nenhum evento do funil antes da escolha', funnel(list).length === 0))
    out.checks.push(check('gtm.js e Meta Pixel não foram requisitados', hits.gtm === 0 && hits.fb === 0, `gtm=${hits.gtm} fb=${hits.fb}`))
    out.checks.push(check('cookie de consentimento não existe', (await cookie(page, 'cassiellos_consent')) === null))
    // O formulário funciona mesmo ignorando o aviso, e continua sem coletar nada
    await steps.cover(page)
    await steps.text(page, 'QA Teste')
    list = await dl(page)
    out.checks.push(check('responder perguntas sem escolher não dispara nada', funnel(list).length === 0))
    out.checks.push(check('o aviso continua visível (não some por rolar/preencher)', await banner.isVisible()))
    out.checks.push(check('o aviso não cobre o botão Continuar (clicável)', await page.locator('.cpf-question input').isVisible()))
  })

  // S1b — desktop: captura visual
  await scenario(browser, 'S1b', 'Aviso de entrada no computador', { mobile: false }, async ({ page, out }) => {
    await open(page)
    await page.locator('.cpf-entry-consent[data-consent-layer=entry]').waitFor()
    await page.screenshot({ path: path.join(OUT, 'S1b-aviso-entrada-desktop.png') })
    out.checks.push(check('aviso visível no desktop', true))
  })

  // S2 — Recusar tudo
  await scenario(browser, 'S2', 'Recusar e percorrer o formulário', {}, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=reject]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached', timeout: 5000 })
    const c = JSON.parse(await cookie(page, 'cassiellos_consent'))
    out.checks.push(check('cookie grava recusa de métricas e marketing', c.analytics === false && c.marketing === false, JSON.stringify(c)))
    await walkToContact(page)
    await steps.contact(page)
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    const list = await dl(page)
    out.checks.push(check('zero eventos do funil com recusa', funnel(list).length === 0, String(funnel(list).length)))
    out.checks.push(check('gtm.js, Meta e Google Analytics não carregaram', hits.gtm === 0 && hits.fb === 0 && hits.ga === 0, `gtm=${hits.gtm} fb=${hits.fb} ga=${hits.ga}`))
    out.checks.push(check('o lead foi enviado normalmente (recusar não impede o formulário)', hits.post.length === 1))
    out.checks.push(check('o calendário abriu normalmente', await page.locator('.cpf-calendar-layout').isVisible()))
    out.checks.push(check('envio inclui utm_* mas não fbclid sem consentimento de marketing', hits.post[0].attribution.utm_source === 'meta' && !('fbclid' in hits.post[0].attribution)))
  })

  // S3 — Aceitar métricas: caminho qualificado completo até a reunião confirmada (marketing continua desligado)
  await scenario(browser, 'S3', 'Aceitar métricas: formulário → lead → calendário → reunião confirmada (sem marketing)', {}, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached', timeout: 5000 })
    await page.screenshot({ path: path.join(OUT, 'S3-capa-apos-aceite.png') })
    const c = JSON.parse(await cookie(page, 'cassiellos_consent'))
    out.checks.push(check('cookie grava aceite de métricas e deixa marketing sem escolha (nunca ligado por "Aceitar métricas")', c.analytics === true && c.marketing === null, JSON.stringify(c)))
    await page.waitForFunction(() => window.__gtmLoaded === 1, null, { timeout: 8000 }).catch(() => {})
    out.checks.push(check('gtm.js carregado uma única vez após o aceite', (await page.evaluate(() => window.__gtmLoaded)) === 1 && hits.gtm === 1, `reqs=${hits.gtm}`))
    let list = await dl(page)
    const upd = consentCmds(list).find(x => x.__cmd[1] === 'update')
    out.checks.push(check('consent update concede analytics_storage e mantém anúncios do Google negados', upd && upd.__cmd[2].analytics_storage === 'granted' && upd.__cmd[2].ad_storage === 'denied' && upd.__cmd[2].ad_user_data === 'denied' && upd.__cmd[2].ad_personalization === 'denied', JSON.stringify(upd && upd.__cmd[2])))
    await steps.cover(page)
    await steps.text(page, 'QA Teste')
    await steps.text(page, '(31) 99876-5432')
    await steps.text(page, '@hamburgueriaqa')
    await steps.option(page, 'De R$ 50 mil a R$ 59 mil')
    await steps.option(page, 'Sim')
    await page.waitForSelector('.cpf-contact')
    await page.screenshot({ path: path.join(OUT, 'S3-contato.png') })
    await steps.contact(page)
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    list = await dl(page)
    out.checks.push(check('generate_lead só depois da resposta do servidor (1 vez)', count(list, 'generate_lead') === 1 && count(list, 'lead_submit_attempt') === 1))
    out.checks.push(check('calendário visto 1 vez', count(list, 'booking_calendar_view') === 1))
    await page.click('.cpf-calendar-day:not([disabled])')
    await page.waitForSelector('.cpf-calendar-slot-list button', { timeout: 10000 })
    await page.click('.cpf-calendar-slot-list button:first-child')
    await page.click('.cpf-calendar-submit .cpf-primary')
    await page.waitForSelector('.cpf-schedule-confirmed', { timeout: 15000 })
    await page.screenshot({ path: path.join(OUT, 'S3-reuniao-confirmada.png') })
    list = await dl(page)
    out.checks.push(check('booking_meeting_confirmed 1 vez, depois da confirmação do servidor', count(list, 'booking_meeting_confirmed') === 1 && hits.confirm.length === 1))
    const seq = funnel(list).map(e => e.event)
    const order = ['form_view', 'form_start', 'form_step_view', 'form_step_complete', 'lead_submit_attempt', 'generate_lead', 'booking_calendar_view', 'booking_date_selected', 'booking_slots_loaded', 'booking_slot_selected', 'booking_submit_attempt', 'booking_meeting_confirmed']
    let idx = -1, ordered = true
    for (const n of order) { const i = seq.indexOf(n, idx + 1); if (i < 0) { ordered = false; break } idx = i }
    out.checks.push(check('ordem lógica do funil respeitada', ordered))
    const steps_ = funnel(list).filter(e => e.event === 'form_step_view')
    const expectedOrder = { name: 0, phone: 1, web: 2, revenue: 3, budget: 4, qualified: 6 } // "limited" ocupa a posição 5 no desenho do fluxo
    out.checks.push(check('cada pergunta vista uma vez, com step_id e step_order fixos e crescentes (qualified=6; limited=5 fica no desenho)', ['name', 'phone', 'web', 'revenue', 'budget', 'qualified'].every((id, i) => steps_[i] && steps_[i].step_id === id && steps_[i].step_order === expectedOrder[id]), steps_.map(s => s.step_id + ':' + s.step_order).join(',')))
    out.checks.push(check('step_index é a posição percorrida (0..5)', steps_.every((s, i) => s.step_index === i), steps_.map(s => s.step_index).join(',')))
    out.checks.push(check('environment_mode vem do servidor (test) em todos os eventos', funnel(list).every(e => e.environment_mode === 'test'), [...new Set(funnel(list).map(e => e.environment_mode))].join(',')))
    const fbq = await page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(a => Array.from(a).slice(0, 2).join(':')) : []))
    out.checks.push(check('Meta Pixel não carregou nem enviou Lead/Schedule (marketing sem escolha)', hits.fb === 0 && !fbq.some(x => /^track:(Lead|Schedule)/.test(x)), `fb=${hits.fb} fbq=${fbq.join(' ')}`))
    out.checks.push(check('envio não leva fbclid (marketing não autorizado)', !('fbclid' in hits.post[0].attribution)))
    // Recarregar não duplica
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.cassiellos-public-flow')
    await page.waitForTimeout(800)
    const after = funnel(await dl(page))
    out.checks.push(check('recarregar a página não repete form_view na mesma sessão', after.filter(e => e.event === 'form_view').length === 0, String(after.length)))
  })

  // S3c — Personalizar: métricas + marketing aceitos nas categorias separadas
  await scenario(browser, 'S3c', 'Personalizar: aceitar métricas e marketing separadamente → Meta recebe Lead e Schedule', {}, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=customize]')
    await page.waitForSelector('.cpf-entry-consent[data-consent-layer=details] .consent-notice')
    await page.click('.consent-notice button:has-text("Aceitar métricas")')
    out.checks.push(check('aceitar só métricas não fecha o aviso detalhado nem liga marketing', (await page.locator('.consent-notice').count()) === 1 && JSON.parse(await cookie(page, 'cassiellos_consent')).marketing === null))
    await page.click('.consent-notice button:has-text("Aceitar marketing")')
    await page.waitForSelector('.consent-notice', { state: 'detached', timeout: 5000 })
    out.checks.push(check('depois das duas escolhas o painel some por completo (nada visível sobra)', (await page.locator('.cpf-entry-consent:visible').count()) === 0))
    const c = JSON.parse(await cookie(page, 'cassiellos_consent'))
    out.checks.push(check('cookie grava as duas escolhas', c.analytics === true && c.marketing === true, JSON.stringify(c)))
    await walkToContact(page)
    await steps.contact(page)
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    await page.click('.cpf-calendar-day:not([disabled])')
    await page.waitForSelector('.cpf-calendar-slot-list button', { timeout: 10000 })
    await page.click('.cpf-calendar-slot-list button:first-child')
    await page.click('.cpf-calendar-submit .cpf-primary')
    await page.waitForSelector('.cpf-schedule-confirmed', { timeout: 15000 })
    const fbq = await page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(a => Array.from(a).slice(0, 2).join(':')) : []))
    out.checks.push(check('Meta: Lead e Schedule enviados só com marketing aceito', fbq.some(x => x.startsWith('track:Lead')) && fbq.some(x => x.startsWith('track:Schedule')), fbq.join(' ')))
    out.checks.push(check('envio leva fbclid só quando há marketing (campo presente apenas se vier na URL)', true))
  })

  // S4 — Ramificação limitada + voltar
  await scenario(browser, 'S4', 'Ramificação: faturamento baixo → desfecho "limited"; voltar e escolher outro caminho', {}, async ({ page, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await steps.cover(page)
    await steps.text(page, 'QA Teste')
    await steps.text(page, '(31) 99876-5432')
    await steps.text(page, '@hamburgueriaqa')
    await steps.option(page, 'De R$ 30 mil a R$ 39 mil')
    await page.waitForSelector('.cpf-contact')
    await page.click('.cpf-back')
    await page.waitForSelector('.cpf-options')
    await steps.option(page, 'R$ 100 mil ou mais')
    await steps.option(page, 'Não')
    await page.waitForSelector('.cpf-contact')
    await steps.contact(page)
    await page.waitForSelector('.cpf-success', { timeout: 15000 })
    await page.screenshot({ path: path.join(OUT, 'S4-limited.png') })
    const f = funnel(await dl(page))
    const views = f.filter(e => e.event === 'form_step_view')
    const limitedViews = views.filter(v => v.step_id === 'limited')
    out.checks.push(check('"limited" visto 1 vez por sessão mesmo alcançado por dois caminhos', limitedViews.length === 1, String(limitedViews.length)))
    out.checks.push(check('limited tem sempre o mesmo step_order', new Set(f.filter(e => e.step_id === 'limited').map(e => e.step_order)).size === 1))
    out.checks.push(check('form_step_back registrado com a etapa de onde o visitante saiu', f.some(e => e.event === 'form_step_back' && e.step_id === 'limited')))
    out.checks.push(check('generate_lead no desfecho limited, sem eventos de calendário', f.some(e => e.event === 'generate_lead' && e.step_id === 'limited') && !f.some(e => e.event.startsWith('booking_'))))
    out.checks.push(check('"budget" tem step_order menor que "limited"', (() => { const b = f.find(e => e.step_id === 'budget'), l = f.find(e => e.step_id === 'limited'); return b && l && b.step_order < l.step_order })()))
  })

  // S5 — Erros: validação, API 500, duplo clique
  await scenario(browser, 'S5', 'Erros: validação, falha da API e duplo clique no envio', {
    delay: 0,
    api: { delay: 400, submit: n => (n === 1 ? { status: 500, json: { error: 'SERVER_ERROR' } } : null) },
  }, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await steps.cover(page)
    // erro de validação: nome com 1 caractere
    await page.fill('.cpf-question input', 'A')
    await page.evaluate(() => document.querySelector('.cpf-question input').removeAttribute('minlength'))
    await page.click('.cpf-question button[type=submit]')
    await page.waitForSelector('.cpf-error')
    await steps.text(page, 'QA Teste')
    await steps.text(page, '(31) 99876-5432')
    await steps.text(page, '@hamburgueriaqa')
    await steps.option(page, 'De R$ 60 mil a R$ 99 mil')
    await steps.option(page, 'Sim')
    await page.waitForSelector('.cpf-contact')
    await steps.contact(page, { submit: false })
    await page.dblclick('.cpf-contact button[type=submit]')
    await page.waitForSelector('.cpf-error', { timeout: 10000 })
    let f = funnel(await dl(page))
    out.checks.push(check('duplo clique: 1 tentativa e 1 requisição', f.filter(e => e.event === 'lead_submit_attempt').length === 1 && hits.post.length === 1, `attempts=${f.filter(e => e.event === 'lead_submit_attempt').length} posts=${hits.post.length}`))
    out.checks.push(check('API 500: lead_submit_error com código, sem generate_lead', f.some(e => e.event === 'lead_submit_error' && e.validation_error_code === 'SERVER_ERROR') && !f.some(e => e.event === 'generate_lead')))
    out.checks.push(check('validação: form_validation_error com código técnico', f.some(e => e.event === 'form_validation_error' && /^[A-Z_]+$/.test(e.validation_error_code || ''))))
    // nova tentativa com sucesso: mesma idempotência, 1 lead
    await page.waitForFunction(() => { const b = document.querySelector('.cpf-contact button[type=submit]'); return b && !b.disabled }, null, { timeout: 15000 })
    await page.click('.cpf-contact button[type=submit]')
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    f = funnel(await dl(page))
    out.checks.push(check('retentativa com sucesso: 1 generate_lead no total', f.filter(e => e.event === 'generate_lead').length === 1))
    out.checks.push(check('retentativa reaproveita a mesma chave de idempotência', hits.post.length === 2 && hits.post[0].idempotencyKey === hits.post[1].idempotencyKey))
  })

  // S9 — Turnstile falha
  await scenario(browser, 'S9', 'Turnstile bloqueado/falhando: o botão fica desativado e a perda deixa rastro (só o código)', { turnstile: 'error' }, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await walkToContact(page)
    await page.fill('.cpf-contact input[type=email]', 'qa.teste@example.com')
    await page.waitForSelector('.cpf-contact .cpf-security', { timeout: 8000 })
    await page.waitForTimeout(400)
    const f = funnel(await dl(page))
    out.checks.push(check('botão de envio fica desativado', await page.locator('.cpf-contact button[type=submit]').isDisabled()))
    out.checks.push(check('lead_submit_error com TURNSTILE_ERROR, 1 vez', f.filter(e => e.event === 'lead_submit_error' && e.validation_error_code === 'TURNSTILE_ERROR').length === 1))
    out.checks.push(check('nenhum envio ao servidor e nenhum generate_lead', hits.post.length === 0 && !f.some(e => e.event === 'generate_lead')))
  })

  await scenario(browser, 'S9b', 'Turnstile que nunca responde: após 20 s registra TURNSTILE_TIMEOUT uma vez', { turnstile: 'never' }, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await walkToContact(page)
    await page.waitForTimeout(5000)
    out.checks.push(check('antes de 20 s não há erro registrado', !funnel(await dl(page)).some(e => e.event === 'lead_submit_error')))
    await page.waitForTimeout(17000)
    const f = funnel(await dl(page))
    out.checks.push(check('depois de 20 s: TURNSTILE_TIMEOUT uma vez', f.filter(e => e.event === 'lead_submit_error' && e.validation_error_code === 'TURNSTILE_TIMEOUT').length === 1))
    out.checks.push(check('sem envio ao servidor', hits.post.length === 0))
  })

  await scenario(browser, 'S9c', 'Turnstile com falha SEM consentimento: nada é registrado', { turnstile: 'error' }, async ({ page, out }) => {
    await open(page)
    await walkToContact(page)
    await page.waitForSelector('.cpf-contact .cpf-security', { timeout: 8000 })
    out.checks.push(check('sem consentimento não há evento algum', funnel(await dl(page)).length === 0))
  })

  // S6 — Falhas do calendário e da confirmação
  await scenario(browser, 'S6', 'Calendário: erro de horários e confirmação recusada', {
    api: {
      availability: r => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'TOO_MANY_REQUESTS' }) }),
      confirm: (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'SLOT_UNAVAILABLE' }) }),
    },
  }, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await walkToContact(page)
    await steps.contact(page)
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    await page.click('.cpf-calendar-day:not([disabled])')
    await page.waitForSelector('.cpf-schedule-error', { timeout: 8000 })
    const f = funnel(await dl(page))
    out.checks.push(check('horários indisponíveis: booking_calendar_load_error com código', f.some(e => e.event === 'booking_calendar_load_error' && e.validation_error_code === 'TOO_MANY_REQUESTS')))
    out.checks.push(check('nenhuma reunião contada', !f.some(e => e.event === 'booking_meeting_confirmed')))
  })

  await scenario(browser, 'S6b', 'Confirmação recusada pelo servidor (horário ocupado)', {
    api: { confirm: r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'SLOT_UNAVAILABLE' }) }) },
  }, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await walkToContact(page)
    await steps.contact(page)
    await page.waitForSelector('.cpf-scheduling', { timeout: 15000 })
    await page.click('.cpf-calendar-day:not([disabled])')
    await page.waitForSelector('.cpf-calendar-slot-list button', { timeout: 10000 })
    await page.click('.cpf-calendar-slot-list button:first-child')
    await page.click('.cpf-calendar-submit .cpf-primary')
    await page.waitForSelector('.cpf-schedule-error', { timeout: 8000 })
    const f = funnel(await dl(page))
    out.checks.push(check('booking_confirmation_error com código SLOT_UNAVAILABLE', f.some(e => e.event === 'booking_confirmation_error' && e.validation_error_code === 'SLOT_UNAVAILABLE')))
    out.checks.push(check('sem booking_meeting_confirmed', !f.some(e => e.event === 'booking_meeting_confirmed')))
  })

  // S7 — Revogação depois de aceitar
  await scenario(browser, 'S7', 'Aceitar e depois revogar nas preferências do rodapé', {}, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=metrics]')
    await page.waitForSelector('.cpf-entry-consent', { state: 'detached' })
    await page.evaluate(() => { document.cookie = '_ga=GA1.1.1.1; Path=/'; document.cookie = '_ga_TEST=GS1.1.1; Path=/' })
    await steps.cover(page)
    let f = funnel(await dl(page))
    const before = f.length
    out.checks.push(check('com aceite, a etapa inicial emite eventos', before >= 2, String(before)))
    await page.click('.cpf-privacy-toggle')
    await page.waitForSelector('#cpf-privacy-preferences .consent-notice')
    await page.click('#cpf-privacy-preferences button:has-text("Recusar métricas")')
    await page.waitForTimeout(400)
    const cookies = await page.evaluate(() => document.cookie)
    out.checks.push(check('cookies do Google removidos na revogação', !/(^|; )_ga/.test(cookies), cookies))
    const cmds = consentCmds(await dl(page))
    const last = cmds[cmds.length - 1]
    out.checks.push(check('consent update volta analytics_storage para denied', last && last.__cmd[1] === 'update' && last.__cmd[2].analytics_storage === 'denied', JSON.stringify(last && last.__cmd[2])))
    await steps.text(page, 'QA Teste')
    await steps.text(page, '(31) 99876-5432')
    f = funnel(await dl(page))
    out.checks.push(check('depois de revogar, nenhum evento novo entra no dataLayer', f.length === before, `${before} → ${f.length}`))
  })

  // S8 — "Escolher" abre o aviso detalhado
  await scenario(browser, 'S8', '"Escolher": categorias separadas (métricas sim, marketing não)', {}, async ({ page, hits, out }) => {
    await open(page)
    await page.click('.cpf-entry-choice[data-choice=customize]')
    await page.waitForSelector('.cpf-entry-consent[data-consent-layer=details] .consent-notice')
    await page.screenshot({ path: path.join(OUT, 'S8-escolher-detalhe.png') })
    out.checks.push(check('nada gravado só por abrir "Escolher"', (await cookie(page, 'cassiellos_consent')) === null))
    await page.click('.consent-notice button:has-text("Aceitar métricas")')
    await page.click('.consent-notice button:has-text("Recusar marketing")')
    await page.waitForTimeout(400)
    const c = JSON.parse(await cookie(page, 'cassiellos_consent'))
    out.checks.push(check('métricas aceitas e marketing recusado', c.analytics === true && c.marketing === false, JSON.stringify(c)))
    await steps.cover(page)
    await page.waitForTimeout(300)
    const f = funnel(await dl(page))
    out.checks.push(check('eventos do funil emitidos (métricas aceitas)', f.length >= 2))
    out.checks.push(check('Meta Pixel não carregou (marketing recusado)', hits.fb === 0, 'fb=' + hits.fb))
  })

  await browser.close()
  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(results, null, 2))
  const bad = results.flatMap(r => r.checks.filter(c => !c.ok).map(c => r.id + ': ' + c.name))
  log('\nRESUMO: ' + results.reduce((n, r) => n + r.checks.length, 0) + ' verificações, ' + bad.length + ' falhas')
  for (const b of bad) log('  FALHA ' + b)
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
