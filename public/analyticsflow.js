/* AnalyticsFlow Browser SDK — first-party, provider-agnostic e consent-aware. */
const CHAVES = Object.freeze({ visitor: 'cassiellos.analytics.visitor', session: 'cassiellos.analytics.session', sessionStarted: 'cassiellos.analytics.session.started', campaign: 'cassiellos.analytics.campaign' })
const texto = (valor, limite = 200) => typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, limite) : null
const ler = (storage, chave) => { try { return storage?.getItem(chave) || null } catch { return null } }
const gravar = (storage, chave, valor) => { try { storage?.setItem(chave, valor); return true } catch { return false } }

function criarAnalyticsFlow(ambiente = globalThis) {
  const doc = ambiente.document; const nav = ambiente.navigator; const location = ambiente.location
  let config = null; let listener = null
  const novoId = () => ambiente.crypto.randomUUID()
  function campanhaAtual(consentimento) {
    const p = new URLSearchParams(location.search || '')
    const atual = { utm_source: texto(p.get('utm_source')), utm_medium: texto(p.get('utm_medium')), utm_campaign: texto(p.get('utm_campaign')), utm_content: texto(p.get('utm_content')), gclid: texto(p.get('gclid'), 300), fbclid: texto(p.get('fbclid'), 300) }
    const temAtual = Object.values(atual).some(Boolean)
    if (consentimento && temAtual) gravar(ambiente.sessionStorage, CHAVES.campaign, JSON.stringify(atual))
    if (temAtual || !consentimento) return atual
    try { return { ...atual, ...JSON.parse(ler(ambiente.sessionStorage, CHAVES.campaign) || '{}') } } catch { return atual }
  }
  function identidades(consentimento) {
    if (!consentimento) return { visitor_id: null, session_id: null }
    let visitor_id = ler(ambiente.localStorage, CHAVES.visitor); if (!visitor_id) { visitor_id = novoId(); gravar(ambiente.localStorage, CHAVES.visitor, visitor_id) }
    let session_id = ler(ambiente.sessionStorage, CHAVES.session); if (!session_id) { session_id = novoId(); gravar(ambiente.sessionStorage, CHAVES.session, session_id) }
    return { visitor_id, session_id }
  }
  function enviar(payload) {
    const corpo = JSON.stringify(payload)
    if (typeof nav?.sendBeacon === 'function') { const blob = new ambiente.Blob([corpo], { type: 'application/json' }); if (nav.sendBeacon(config.endpoint, blob)) return Promise.resolve({ queued: true, transport: 'beacon' }) }
    return ambiente.fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, credentials: 'same-origin', keepalive: true }).then(r => ({ queued: r.ok, transport: 'fetch', status: r.status })).catch(() => ({ queued: false, transport: 'fetch' }))
  }
  function track(event_type, dados = {}) {
    if (!config) return Promise.resolve({ queued: false, reason: 'not_initialized' })
    return enviar({ event_id: novoId(), timestamp: new Date().toISOString(), client_id: config.clientId, ...config.identidades, ...config.campanha, event_type, url: location.href, referrer: texto(doc?.referrer, 2048), content_id: texto(dados.content_id, 128), campaign_id: texto(dados.campaign_id, 128), lead_id: texto(dados.lead_id, 128), conversion_id: texto(dados.conversion_id, 128), value: dados.value ?? null, currency: texto(dados.currency, 3) })
  }
  function observarInteracoes() {
    if (!doc?.addEventListener) return
    listener = event => { const alvo = event.target?.closest?.('a,button,form'); if (!alvo) return; const href = alvo.getAttribute?.('href') || ''; if (/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com)\//i.test(href)) track('whatsapp_click'); else if (alvo.matches?.('[data-analytics-cta]')) track('cta_click'); else if (event.type === 'submit' && alvo.matches?.('form[data-analytics-form]')) track('form_submit') }
    doc.addEventListener('click', listener, true); doc.addEventListener('submit', listener, true)
  }
  function init(opcoes = {}) {
    const clientId = texto(opcoes.clientId, 128); if (!clientId) throw new Error('AnalyticsFlow: clientId obrigatório')
    if (!location || !['http:', 'https:'].includes(location.protocol)) throw new Error('AnalyticsFlow: contexto web inválido')
    const consentimento = opcoes.consent === 'granted'; const endpoint = texto(opcoes.endpoint, 500) || '/api/analytics/events'
    let destino; try { destino = new URL(endpoint, location.href) } catch { throw new Error('AnalyticsFlow: endpoint inválido') }
    if (destino.origin !== new URL(location.href).origin) throw new Error('AnalyticsFlow: endpoint precisa ser same-origin')
    config = { clientId, endpoint, identidades: identidades(consentimento), campanha: campanhaAtual(consentimento) }; observarInteracoes()
    const iniciou = consentimento && ler(ambiente.sessionStorage, CHAVES.sessionStarted) === '1'; if (!iniciou) { track('session_start'); if (consentimento) gravar(ambiente.sessionStorage, CHAVES.sessionStarted, '1') }
    track('page_view'); return { consent: consentimento ? 'granted' : 'denied', ...config.identidades }
  }
  return Object.freeze({ init, track })
}
if (typeof window !== 'undefined') window.CassiellosAnalytics = criarAnalyticsFlow(window)
