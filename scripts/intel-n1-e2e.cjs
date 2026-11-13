#!/usr/bin/env node
/**
 * M09 — teste de navegador do N1 (laço de requisições) e das interações da Central de Inteligência.
 *
 * Roda contra um build de PRODUÇÃO LOCAL (next build && next start) com dados simulados — nunca contra Production.
 * Requer Playwright/Chromium instalados no ambiente (não é dependência do projeto). Variáveis:
 *   INTEL_E2E_BASE    URL base (padrão http://localhost:3111)
 *   INTEL_E2E_COOKIE  valor do cookie de sessão de TESTE (gerado localmente com segredo descartável; nada é gravado aqui)
 *   INTEL_E2E_COOKIE_NAME  nome do cookie (padrão __Host-cassiellos_crm, o de NODE_ENV=production)
 * Saída: tabela + JSON em INTEL_E2E_OUT (opcional). Código de saída ≠ 0 se alguma asserção falhar.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')

const BASE = process.env.INTEL_E2E_BASE || 'http://localhost:3111'
const COOKIE = process.env.INTEL_E2E_COOKIE
const COOKIE_NAME = process.env.INTEL_E2E_COOKIE_NAME || '__Host-cassiellos_crm'
if (!COOKIE) { console.error('Defina INTEL_E2E_COOKIE (cookie de sessão de teste).'); process.exit(2) }
const failures = []
const results = []
const check = (ok, label, detail = '') => { results.push({ ok, label, detail }); if (!ok) failures.push(label + (detail ? ' — ' + detail : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.setExtraHTTPHeaders({ Cookie: COOKIE_NAME + '=' + COOKIE })
  const page = await ctx.newPage()
  const st = { calls: [], last: null, posts: 0 }
  page.on('request', r => { if (r.url().includes('/api/crm/intel')) { if (r.method() === 'GET') st.calls.push(r.url()); else st.posts++ } })
  page.on('response', async r => { if (r.url().includes('/api/crm/intel') && r.request().method() === 'GET' && r.status() === 200) { try { st.last = await r.json() } catch {} } })
  return { ctx, page, st }
}

const busy = page => page.getAttribute('div[aria-live="polite"]', 'aria-busy')
async function untilIdle(page, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) { if ((await busy(page)) === 'false') return true; await sleep(50) }
  return false
}
async function uiFilters(page) {
  return page.evaluate(() => {
    const val = label => { const f = [...document.querySelectorAll('.mi-field')].find(x => x.querySelector('span')?.textContent === label); return f?.querySelector('select')?.value }
    const pressed = group => document.querySelector('[role=group][aria-label="' + group + '"] [aria-pressed=true]')?.textContent ?? null
    return { period: val('Período'), client: val('Cliente'), platform: pressed('Plataforma'), status: pressed('Situação atual das campanhas'), search: document.querySelector('input[type=search]')?.value ?? null, h1: document.querySelector('h1')?.textContent }
  })
}
const PLAT = { all: 'Todas', google_ads: 'Google Ads', meta_ads: 'Meta Ads' }
const STAT = { all: 'Todas', active: 'Ativas', paused: 'Pausadas' }

/** UI, URL e API (filtros efetivos da última resposta) precisam dizer a mesma coisa. */
async function consistent(page, st, label) {
  const eff = st.last?.view?.meta?.filters
  const ui = await uiFilters(page)
  const url = new URL(page.url()).searchParams
  if (!eff) return check(false, label + ': consistência UI/URL/API', 'sem resposta da API')
  const diffs = []
  if (url.get('area') !== (eff.area === 'agencia' ? 'agencia' : eff.area)) diffs.push('url.area')
  if ((url.get('period') ?? '30d') !== eff.period) diffs.push('url.period')
  if ((url.get('platform') ?? 'all') !== eff.platform) diffs.push('url.platform')
  if ((url.get('status') ?? 'all') !== eff.status) diffs.push('url.status')
  if ((url.get('client') ?? 'all') !== (eff.client || 'all')) diffs.push('url.client')
  if ((url.get('campaign') ?? '') !== eff.campaign) diffs.push('url.campaign')
  if (ui.period !== eff.period) diffs.push('ui.period')
  if (ui.client !== undefined && ui.client !== eff.client) diffs.push('ui.client')
  if (ui.platform !== PLAT[eff.platform]) diffs.push('ui.platform')
  if (ui.status !== null && ui.status !== STAT[eff.status]) diffs.push('ui.status')
  if (ui.search !== null && ui.search !== eff.campaign) diffs.push('ui.search')
  check(diffs.length === 0, label + ': UI = URL = filtros efetivos da API', diffs.join(','))
}

async function initial(browser, area, query, maxCalls) {
  const { ctx, page, st } = await newPage(browser, { width: 1440, height: 900 })
  await page.goto(BASE + '/crm/inteligencia?' + query, { waitUntil: 'domcontentloaded' })
  const idle = await untilIdle(page)
  const afterLoad = st.calls.length
  await sleep(5500) // monitoramento depois de estabilizar (≥ 5 s)
  const afterMonitor = st.calls.length
  check(idle, area + ': carregamento termina (aria-busy=false)')
  check(afterLoad >= 1 && afterLoad <= maxCalls, area + ': chamadas no carregamento ≤ ' + maxCalls, String(afterLoad))
  check(afterMonitor === afterLoad, area + ': nenhuma chamada nova em 5,5 s sem interação', afterLoad + ' → ' + afterMonitor)
  check((await busy(page)) === 'false', area + ': aria-busy=false depois do monitoramento')
  const opacity = await page.$eval('.mi-area', e => getComputedStyle(e).opacity)
  check(opacity === '1' && (await page.$eval('.mi-area', e => e.getAttribute('data-loading'))) === null, area + ': conteúdo com opacidade normal', opacity)
  const disabled = await page.$$eval('.mi-filters select, .mi-filters button, .mi-filters input', els => els.filter(e => e.disabled).length)
  check(disabled === 0, area + ': botões e filtros disponíveis', 'desabilitados: ' + disabled)
  await consistent(page, st, area + ' (estado inicial)')
  results.push({ ok: true, label: 'CONTAGEM ' + area, detail: 'carga=' + afterLoad + ' após 5,5 s=' + afterMonitor })
  await ctx.close()
}

async function stepper(page, st) {
  return async (label, action, expected) => {
    const before = st.calls.length
    await action()
    await sleep(900) // > debounce da busca (350 ms) e tempo para a requisição sair
    await untilIdle(page)
    await sleep(400)
    const made = st.calls.length - before
    check(made === expected, label + ': ' + expected + ' requisição(ões)', 'feitas: ' + made)
    await consistent(page, st, label)
  }
}

async function interactions(browser) {
  const { ctx, page, st } = await newPage(browser, { width: 1440, height: 900 })
  await page.goto(BASE + '/crm/inteligencia?area=agencia', { waitUntil: 'domcontentloaded' })
  await untilIdle(page); await sleep(600)
  check(st.calls.length === 1, 'interações: carga inicial da Visão geral = 1 chamada', String(st.calls.length))
  const step = await stepper(page, st)
  const field = label => page.locator('.mi-field', { has: page.locator('span', { hasText: new RegExp('^' + label) }) })
  const seg = (group, text) => page.locator('[role=group][aria-label="' + group + '"] button', { hasText: new RegExp('^' + text + '$') }).click()
  const nav = text => page.locator('.mi-nav .crm-nav-btn', { hasText: text }).click()
  await step('período 7 dias', () => field('Período').locator('select').selectOption('7d'), 1)
  await step('período 7 dias de novo (mesmo valor)', () => field('Período').locator('select').selectOption('7d'), 0)
  await step('plataforma Meta Ads', () => seg('Plataforma', 'Meta Ads'), 1)
  await step('plataforma Google Ads', () => seg('Plataforma', 'Google Ads'), 1)
  await step('plataforma Todas', () => seg('Plataforma', 'Todas'), 1)
  await step('situação Ativas', () => seg('Situação atual das campanhas', 'Ativas'), 1)
  await step('situação Pausadas', () => seg('Situação atual das campanhas', 'Pausadas'), 1)
  await step('situação Todas', () => seg('Situação atual das campanhas', 'Todas'), 1)
  await step('situação Pausadas (preparo M5)', () => seg('Situação atual das campanhas', 'Pausadas'), 1)
  await step('área Cliente (contexto preservado)', () => nav('Visão do cliente'), 1)
  check((await uiFilters(page)).status === 'Pausadas', 'M5: situação Pausadas preservada na área Cliente')
  const clientOptions = await field('Cliente').locator('select option').evaluateAll(o => o.map(x => x.value))
  const other = clientOptions.find(v => v && v !== (st.last?.view?.meta?.filters?.client)) // outro cliente
  await step('trocar de cliente', () => field('Cliente').locator('select').selectOption(other), 1)
  await step('busca de campanha (digitação única, 1 requisição)', () => page.locator('input[type=search]').fill('leads'), 1)
  await step('limpar busca', () => page.locator('input[type=search]').fill(''), 1)
  await step('área Conexões', () => nav('Conexões e integrações'), 1)
  const connUi = await uiFilters(page)
  check(connUi.status === null, 'M5: Conexões não exibe situação das campanhas')
  check(st.last?.view?.meta?.filters?.status === 'all' && st.last?.view?.meta?.filters?.campaign === '', 'M5: Conexões — situação neutra e busca limpa na API')
  await step('voltar à Visão geral', () => nav('Visão geral da agência'), 1)
  check((await uiFilters(page)).status === 'Pausadas' && (await uiFilters(page)).period === '7d', 'M5: contexto anterior (7d, Pausadas) restaurado ao voltar')
  await step('área Prospecção', () => nav('Prospecção Cassiellos'), 1)
  await step('voltar à Visão geral (de novo)', () => nav('Visão geral da agência'), 1)
  await step('Recarregar (atualização manual)', () => page.locator('.mi-refresh').click(), 1)
  const n = st.calls.length
  await sleep(5500)
  check(st.calls.length === n, 'interações: nenhuma chamada depois de 5,5 s parado', n + ' → ' + st.calls.length)
  await ctx.close()
}

async function clientSync(browser) {
  // Atualização simulada de uma conta (POST) + recarga única dos dados; nada vaza e nada entra em laço.
  const { ctx, page, st } = await newPage(browser, { width: 1440, height: 900 })
  await page.goto(BASE + '/crm/inteligencia?area=cliente&client=cli_demo_a', { waitUntil: 'domcontentloaded' })
  await untilIdle(page); await sleep(500)
  const before = st.calls.length
  const btn = page.locator('button', { hasText: /Atualizar agora|Simular atualização|Atualizar/ }).first()
  if (await btn.count() && await btn.isEnabled()) {
    await btn.click(); await sleep(1500); await untilIdle(page); await sleep(800)
    check(st.posts === 1, 'botão Atualizar: 1 POST', String(st.posts))
    check(st.calls.length - before === 1, 'botão Atualizar: 1 recarga dos dados', String(st.calls.length - before))
    const n = st.calls.length; await sleep(5000)
    check(st.calls.length === n, 'botão Atualizar: sem chamadas depois da recarga')
  } else check(true, 'botão Atualizar da conta indisponível neste estado (nada a testar)')
  await ctx.close()
}

async function mobile(browser) {
  const { ctx, page, st } = await newPage(browser, { width: 390, height: 844 })
  await page.goto(BASE + '/crm/inteligencia?area=agencia', { waitUntil: 'domcontentloaded' })
  await untilIdle(page); await sleep(5500)
  check(st.calls.length === 1, 'mobile 390: Visão geral estável (1 chamada em 5,5 s)', String(st.calls.length))
  const toggle = page.locator('.mi-nav-toggle')
  check(await toggle.isVisible(), 'mobile 390: botão Áreas visível')
  await toggle.click(); await sleep(300)
  check((await toggle.getAttribute('aria-expanded')) === 'true' && (await page.locator('#mi-areas').getAttribute('data-open')) === 'true', 'mobile 390: menu de áreas expande')
  await page.locator('.mi-nav .crm-nav-btn', { hasText: 'Visão do cliente' }).click(); await sleep(900); await untilIdle(page); await sleep(400)
  check((await toggle.getAttribute('aria-expanded')) === 'false', 'mobile 390: menu fecha ao escolher uma área')
  check(st.calls.length <= 3, 'mobile 390: navegação para Cliente com ≤ 2 requisições novas', String(st.calls.length - 1))
  const cards = await page.locator('.mi-table-campaigns tbody tr').count()
  const asCards = cards ? await page.$eval('.mi-table-campaigns tbody tr', tr => getComputedStyle(tr).display === 'grid' && getComputedStyle(tr.closest('table').querySelector('thead')).display === 'none') : false
  check(cards > 0 && asCards, 'mobile 390: campanhas exibidas como cartões (tabela sem cabeçalho, 1 coluna)', 'linhas: ' + cards)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(overflow <= 1, 'mobile 390: sem rolagem horizontal da página', String(overflow))
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch()
  const only = process.env.INTEL_E2E_ONLY // 'initial' = só o estado inicial das 4 áreas
  await initial(browser, 'Prospecção', 'area=prospeccao', 1)
  await initial(browser, 'Visão geral', 'area=agencia', 1)
  await initial(browser, 'Visão do cliente (sem cliente na URL)', 'area=cliente', 2)
  await initial(browser, 'Visão do cliente (cliente na URL)', 'area=cliente&client=cli_demo_a', 1)
  await initial(browser, 'Conexões', 'area=conexoes', 1)
  if (only !== 'initial') { await interactions(browser); await clientSync(browser); await mobile(browser) }
  await browser.close()
  for (const r of results) console.log((r.ok ? 'OK    ' : 'FALHA ') + r.label + (r.detail ? ' [' + r.detail + ']' : ''))
  if (process.env.INTEL_E2E_OUT) fs.writeFileSync(process.env.INTEL_E2E_OUT, JSON.stringify(results, null, 2))
  console.log('\n' + (results.length - failures.length) + '/' + results.length + ' verificações OK')
  if (failures.length) { console.error('\nFALHAS:\n- ' + failures.join('\n- ')); process.exit(1) }
})().catch(e => { console.error(e); process.exit(1) })
