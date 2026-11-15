/**
 * Cartão de conta (AssetCardView): o aviso do botão de sincronização segue o modo de dados.
 * Modo real → descreve a sincronização real com gravação no banco; demonstração → mantém o aviso de simulação.
 * Renderização no servidor (sem navegador, sem rede, sem banco).
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssetCard } from './view-types'

// O projeto usa jsx "preserve" (o Next.js compila o JSX); no carregador de testes o JSX vira React.createElement.
type UI = typeof import('../../../app/crm/inteligencia/intel-ui')
let AssetCardView: UI['AssetCardView']
let DataModeContext: UI['DataModeContext']

const REAL_TITLE = 'Sincroniza dados reais da plataforma e registra os resultados no banco. Limite de uma atualização a cada 15 minutos por conta.'
const DEMO_TITLE = 'Simulação: nada é gravado em banco; limite de 1 atualização a cada 15 minutos por conta'

const card = (manualSync: AssetCard['manualSync']): AssetCard => ({
  assetId: 'a1', platform: 'google_ads', externalIdLabel: '111-111-1111', name: 'Conta Teste', currency: 'BRL', timeZone: 'America/Sao_Paulo',
  association: 'confirmed', accountStatus: 'active', connectionStatus: 'active', accessPath: 'direct', state: 'connected',
  lastSyncAt: null, lastSuccessAt: null, lastRunStatus: null, alerts: [], note: '', connectionLabel: 'Google Ads', platformAccess: 'yes',
  syncAuthorized: true, syncBlockReason: null, manualSync,
})

function render(mode: 'demo' | 'real', manualSync: AssetCard['manualSync'] = { allowed: true, reason: null, retryAt: null }) {
  const html = renderToStaticMarkup(createElement(DataModeContext.Provider, { value: mode },
    createElement(AssetCardView, { a: card(manualSync), now: new Date('2026-11-15T12:00:00Z'), onSync: () => undefined })))
  const title = /<button[^>]*title="([^"]*)"/.exec(html)?.[1] ?? null
  return { html, title: title?.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') ?? null }
}

describe('AssetCardView — aviso do botão de sincronização', () => {
  before(async () => {
    ;(globalThis as { React?: typeof React }).React = React
    ;({ AssetCardView, DataModeContext } = await import('../../../app/crm/inteligencia/intel-ui'))
  })
  it('modo real: descreve sincronização real gravada no banco, sem mencionar simulação', () => {
    const { html, title } = render('real')
    assert.equal(title, REAL_TITLE)
    assert.ok(!/simula/i.test(title ?? ''))
    assert.ok(html.includes('Sincronizar agora'))
  })
  it('demonstração: preserva o aviso de simulação', () => {
    const { html, title } = render('demo')
    assert.equal(title, DEMO_TITLE)
    assert.ok(html.includes('Atualizar agora (simulação)'))
  })
  it('botão bloqueado: o aviso continua sendo o motivo do bloqueio, nos dois modos', () => {
    const blocked = { allowed: false, reason: 'Conexão expirada', retryAt: null }
    assert.equal(render('real', blocked).title, 'Conexão expirada')
    assert.equal(render('demo', blocked).title, 'Conexão expirada')
  })
})
