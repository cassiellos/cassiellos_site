import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { getEntryNoticeConfig } from './entry-notice-config'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('chave exclusiva do aviso de entrada', () => {
  it('desligada por padrão e com qualquer valor que não seja exatamente "true"', () => {
    assert.deepEqual(getEntryNoticeConfig({}), { enabled: false })
    for (const v of ['', 'TRUE', 'True', '1', 'yes', 'on', 'false', 'true;', 'verdadeiro']) {
      assert.deepEqual(getEntryNoticeConfig({ CONSENT_ENTRY_NOTICE_ENABLED: v }), { enabled: false }, JSON.stringify(v))
    }
  })
  it('liga só com a chave expressa', () => {
    assert.deepEqual(getEntryNoticeConfig({ CONSENT_ENTRY_NOTICE_ENABLED: 'true' }), { enabled: true })
    assert.deepEqual(getEntryNoticeConfig({ CONSENT_ENTRY_NOTICE_ENABLED: ' true ' }), { enabled: true })
  })
  it('é independente das outras chaves: GTM, Pixel e Turnstile não ligam o aviso', () => {
    assert.deepEqual(getEntryNoticeConfig({ TRACKING_GTM_ENABLED: 'true', GTM_FORM_CONTAINER_ID: 'GTM-ABC1234', META_PIXEL_ENABLED: 'true' }), { enabled: false })
  })
  it('a chave não toca em consentimento, Consent Mode, GTM nem Meta (só decide se o aviso aparece)', () => {
    const src = read('lib/privacy/entry-notice-config.ts').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.equal(/consent-client|cassiellos_consent|analytics_storage|ad_storage|ad_user_data|ad_personalization|gtag|dataLayer|fbq|setConsent/.test(src), false)
    assert.equal(/import /.test(src), false, 'sem dependências: não há como a chave alterar o estado de consentimento')
  })
  it('a página repassa a chave e o fluxo só monta o aviso quando ela está ligada', () => {
    const page = read('app/formularios/[slug]/page.tsx')
    assert.match(page, /getEntryNoticeConfig\(\)/)
    assert.match(page, /entryNoticeEnabled=\{entryNotice\.enabled\}/)
    const flow = read('app/formularios/[slug]/public-flow.tsx')
    assert.match(flow, /entryNoticeEnabled=false/, 'o padrão do componente também é desligado')
    assert.match(flow, /\{!previewOnly&&entryNoticeEnabled&&<ConsentEntryBanner /)
    assert.equal([...flow.matchAll(/<ConsentEntryBanner\b/g)].length, 1)
  })
  it('com a chave desligada o rodapé continua sendo o único caminho de consentimento (nada é concedido sozinho)', () => {
    const flow = read('app/formularios/[slug]/public-flow.tsx')
    assert.match(flow, /showPrivacyPreferences&&<ConsentNotice\s+marketingEnabled=/)
    assert.match(flow, /\{!previewOnly&&<GoogleTagManager containerId=\{gtmContainerId\}\/>\}/)
  })
  it('está documentada no .env.example, desligada', () => {
    assert.match(read('.env.example'), /^CONSENT_ENTRY_NOTICE_ENABLED=$/m)
  })
})
