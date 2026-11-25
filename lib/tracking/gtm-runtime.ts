import { CONSENT_CHANGE_EVENT, getConsent } from '../privacy/consent-client'
import { CONSENT_MODE_DEFAULT, consentModeFrom, googleCookieNames, type ConsentModeState } from '../privacy/consent-mode'
import { FUNNEL_EVENT } from '../crm/funnel-client'
import { mapLegacyFunnelEvent } from './funnel-contract'
import { GTM_ID_PATTERN } from './gtm-config'
import { pushTrackingEvent } from './datalayer-client'

/**
 * Execução do Google Tag Manager do formulário no navegador (sem React, testável).
 *
 * - `containerId` nulo/inválido (TRACKING_GTM_ENABLED desligado) → não faz nada.
 * - Consent Mode v2: o padrão "denied" nos quatro sinais é empurrado ANTES de qualquer script do Google; a escolha do
 *   visitante (cookie `cassiellos_consent`) entra como "update". Sem escolha ou com recusa, nada é concedido.
 * - O script do GTM só é carregado depois de o visitante AUTORIZAR as métricas (mesma regra do Meta Pixel e do Vercel
 *   Analytics no escopo do CRM). Recusa/revogação: "update" de volta para "denied", remoção dos cookies do Google e os
 *   eventos do funil deixam de ser empurrados na hora (pushTrackingEvent confere o consentimento a cada chamada).
 * - Ponte dos eventos antigos do /agendar (`cassiellos:funnel`) para o contrato do dataLayer, sem duplicar: o emissor
 *   antigo já deduplica e a ponte só traduz.
 */
export const GTM_SCRIPT_ID = 'cassiellos-gtm'
export const GTM_SCRIPT_ORIGIN = 'https://www.googletagmanager.com/gtm.js'

type Gtag = (command: string, action: string, state: ConsentModeState) => void

function consentCommand(command: string, action: string, state: ConsentModeState) {
  // O GTM exige o objeto `arguments` (não um array) nos comandos de consentimento.
  const gtag = function (this: unknown) { (window.dataLayer as unknown[]).push(arguments) } as unknown as Gtag
  gtag(command, action, state)
}

function clearGoogleCookies() {
  const host = location.hostname
  const parent = host.split('.').slice(-3).join('.')
  for (const name of googleCookieNames(document.cookie)) {
    for (const domain of ['', '; Domain=' + host, '; Domain=.' + parent]) {
      document.cookie = name + '=; Max-Age=0; Path=/' + domain
    }
  }
}

function loadGtm(containerId: string) {
  if (document.getElementById(GTM_SCRIPT_ID)) return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  const script = document.createElement('script')
  script.id = GTM_SCRIPT_ID
  script.async = true
  script.src = GTM_SCRIPT_ORIGIN + '?id=' + encodeURIComponent(containerId)
  document.head.appendChild(script)
}

let defaultSent = false
// Assinatura do último estado de consentimento já enviado ao GTM. Começa igual ao padrão (tudo negado) para que
// um visitante sem escolha não gere um "update" redundante.
const DEFAULT_SIGNATURE = JSON.stringify(consentModeFrom(null))
let lastSignals = DEFAULT_SIGNATURE

/** Liga o GTM do formulário; devolve a função que remove os ouvintes. */
export function startGoogleTagManager(containerId: string | null): () => void {
  if (typeof window === 'undefined' || !containerId || !GTM_ID_PATTERN.test(containerId)) return () => undefined
  window.dataLayer = window.dataLayer || []
  if (!defaultSent) {
    defaultSent = true
    consentCommand('consent', 'default', { ...CONSENT_MODE_DEFAULT })
  }
  const sync = () => {
    const state = consentModeFrom(getConsent())
    const signature = JSON.stringify(state)
    if (signature !== lastSignals) {
      lastSignals = signature
      consentCommand('consent', 'update', state)
    }
    if (state.analytics_storage === 'granted') loadGtm(containerId)
    else clearGoogleCookies()
  }
  sync()
  const onLegacy = (event: Event) => {
    const mapped = mapLegacyFunnelEvent((event as CustomEvent).detail)
    if (mapped) pushTrackingEvent(mapped.name, mapped.params, null, { dedupe: false })
  }
  window.addEventListener(CONSENT_CHANGE_EVENT, sync)
  window.addEventListener(FUNNEL_EVENT, onLegacy)
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
    window.removeEventListener(FUNNEL_EVENT, onLegacy)
  }
}

/** Só para testes: zera o estado de módulo. */
export function resetGoogleTagManagerForTests() {
  defaultSent = false
  lastSignals = DEFAULT_SIGNATURE
}
