import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { TRACKING_EVENTS } from './funnel-contract'

/*
 * Trava, no código-fonte, as garantias que um teste de navegador simulado não enxerga:
 * nenhum dado pessoal vai para o rastreamento, o lead só conta depois da resposta do servidor,
 * a reunião só conta depois da confirmação real, a prévia do painel não emite e o contador global
 * deixou de tratar cada pergunta como envio do formulário.
 */
const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const flow = read('app/formularios/[slug]/public-flow.tsx')
const calendar = read('app/formularios/[slug]/inline-booking-calendar.tsx')
const page = read('app/formularios/[slug]/page.tsx')
const tracker = read('components/site-interaction-tracker.tsx')
const route = read('app/api/public/forms/[slug]/route.ts')
const compact = (source: string) => source.replace(/\s+/g, '')

/** Texto de cada chamada `track(...)` (parênteses balanceados), para inspecionar o que é enviado. */
function trackCalls(source: string) {
  const calls: string[] = []
  const pattern = /\btrack\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    let depth = 1
    let i = match.index + match[0].length
    while (i < source.length && depth > 0) {
      const ch = source[i++]
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    calls.push(source.slice(match.index, i))
  }
  return calls.filter(call => !call.startsWith('track(name'))
}

describe('instrumentação do formulário — garantias no código', () => {
  it('só usa eventos do contrato e nenhuma chamada recebe resposta, nome, e-mail, telefone ou texto digitado', () => {
    const forbidden = /\b(email|phone|whatsapp|freeText|answers?|name|company|website|token|bookingToken|meetUrl|googleMeetUrl|startAt|localTime|value)\b/
    for (const [file, source] of [['public-flow', flow], ['inline-booking-calendar', calendar]] as const) {
      const calls = trackCalls(source)
      assert.ok(calls.length >= 5, file + ' deveria ter chamadas de rastreamento')
      for (const call of calls) {
        // O nome do evento é o que vem antes do primeiro objeto de parâmetros (pode ser um ternário entre dois eventos).
        const head = call.slice('track('.length).split('{')[0]
        const names = [...head.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
        assert.ok(names.length >= 1 && names.every(name => (TRACKING_EVENTS as readonly string[]).includes(name)), call)
        // O 3º argumento (referência) pode ser identificador técnico; só os parâmetros (1º/2º) são inspecionados.
        const args = call.replace(/,\s*(idempotencyKey\.current|chosen\.startAt[^)]*|slot\.startAt|meeting\.bookingRequestId|day)\)$/, ')')
        assert.equal(forbidden.test(args), false, call)
      }
    }
  })

  it('lead só é contado depois da resposta positiva do servidor, e nunca em reaproveitamento', () => {
    const c = compact(flow)
    assert.match(c, /if\(data\?\.ok===true&&data\?\.reused!==true\)track\('generate_lead'/)
    const submitIndex = flow.indexOf("track('lead_submit_attempt'")
    const fetchIndex = flow.indexOf('fetch(', submitIndex)
    const leadIndex = flow.indexOf("track('generate_lead'")
    assert.ok(submitIndex > 0 && fetchIndex > submitIndex && leadIndex > fetchIndex, 'generate_lead vem depois do fetch')
  })

  it('reunião só é contada depois da confirmação do servidor e não é recontada em reabertura', () => {
    const c = compact(calendar)
    assert.match(c, /if\(value\.alreadyConfirmed!==true\)track\('booking_meeting_confirmed',\{\},meeting\.bookingRequestId\)/)
    const confirmFetch = calendar.indexOf('/api/booking/confirm')
    const confirmed = calendar.indexOf("track('booking_meeting_confirmed'")
    assert.ok(confirmFetch > 0 && confirmed > confirmFetch)
    const attempt = calendar.indexOf("track('booking_submit_attempt'")
    assert.ok(attempt > 0 && attempt < confirmFetch, 'tentativa vem antes do pedido, confirmação depois')
  })

  it('prévia do painel nunca emite: modo preview e GTM fora da prévia; calendário começa em preview', () => {
    assert.match(compact(flow), /constmode:TrackingMode=previewOnly\?'preview'/)
    assert.match(compact(flow), /\{!previewOnly&&<GoogleTagManagercontainerId=\{gtmContainerId\}\/>\}/)
    assert.match(compact(calendar), /trackingMode='preview'/)
  })

  it('o modo do evento vem do servidor (CRM_BOOKING_MODE/lista de teste), não de suposição do navegador', () => {
    assert.match(compact(page), /funnelModeFor\(\{bookingMode:getCrmBookingMode\(\),allowlistActive:bookingAccessConfig\(\)\.restrictedToAllowedEmail\}\)/)
    assert.match(compact(route), /leadMode/)
    assert.match(compact(route), /typeofsaved\.isTest==='boolean'/)
    assert.match(compact(flow), /serverMode/)
  })

  it('toda etapa com step_id sai também com a posição fixa (step_order) calculada só pelo desenho do fluxo', () => {
    const c = compact(flow)
    assert.match(c, /conststepOrder=useMemo\(\(\)=>flowStepOrder\(flow\.start,flow\.steps\),\[flow\]\)/)
    assert.match(c, /typeofextra\.step_id==='string'\?stepOrder\[extra\.step_id\]:undefined/)
    assert.match(c, /\.\.\.\(order===undefined\?\{\}:\{step_order:order\}\)/)
  })

  it('GTM só liga com a chave expressa (padrão desligado) e o id vem da configuração do servidor', () => {
    assert.match(compact(page), /gtmContainerId=\{gtm\.enabled\?gtm\.containerId:null\}/)
    assert.equal(/GTM-[A-Z0-9]{4,}/.test(flow + calendar + page), false, 'nenhum ID de container fixo no código')
  })

  it('o contador global não trata mais pergunta intermediária como envio nem como clique de conversão', () => {
    const c = compact(tracker)
    const guards = c.match(/if\(ownsFunnelMetrics\(window\.location\.pathname\)\)return/g) ?? []
    assert.equal(guards.length, 2, 'clique e submit do contador global saem cedo em /agendar e /formularios')
  })

  it('um único emissor: nenhuma chamada direta ao dataLayer nem a gtag fora do módulo de rastreamento', () => {
    for (const source of [flow, calendar, tracker]) {
      assert.equal(/dataLayer\s*[.\[]|\bgtag\(|\bfbq\(.*'(Lead|Schedule)'/.test(source) && !/trackMetaConversion/.test(source), false)
      assert.equal(/window\.dataLayer/.test(source), false)
    }
  })
})
