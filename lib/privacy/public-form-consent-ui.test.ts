import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

/**
 * Consentimento do formulário público.
 * - Entrada: aviso de primeira camada com "Recusar tudo", "Escolher" e "Aceitar tudo" (mesmo peso, sem pré-seleção),
 *   que não bloqueia o formulário nem grava nada sem clique. A decisão de "entrada limpa" anterior (nenhum aviso ao abrir)
 *   foi substituída de propósito: sem escolha o visitante não autoriza nada, e sem aviso ele nunca escolhe.
 * - O aviso detalhado (ConsentNotice) continua montado uma única vez, só por interação explícita no rodapé.
 * - A renderização do Pixel e das métricas permanece condicionada à permissão.
 */
describe('Regressão — formulário público: escolha de consentimento clara na entrada, sem bloquear', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/formularios/[slug]/public-flow.tsx'), 'utf8')
  const pixel = readFileSync(resolve(process.cwd(), 'components/marketing/meta-pixel.tsx'), 'utf8')
  const analytics = readFileSync(resolve(process.cwd(), 'components/analytics-privacy.tsx'), 'utf8')
  const banner = readFileSync(resolve(process.cwd(), 'components/privacy/consent-entry-banner.tsx'), 'utf8')
  const css = readFileSync(resolve(process.cwd(), 'app/formularios/[slug]/public-flow.css'), 'utf8')

  it('começa com preferências do rodapé recolhidas e só monta o ConsentNotice do rodapé por interação explícita', () => {
    assert.match(source, /\[showPrivacyPreferences,setShowPrivacyPreferences\]=useState\(false\)/)
    const matches = [...source.matchAll(/<ConsentNotice\s+marketingEnabled=/g)]
    assert.equal(matches.length, 1, 'o aviso detalhado do rodapé é montado uma única vez')
    assert.match(source, /showPrivacyPreferences&&<ConsentNotice\s+marketingEnabled=/)
    assert.match(source, /onClick=\{\(\)=>setShowPrivacyPreferences\(current=>!current\)\}/)
  })

  it('monta o aviso de entrada só fora da prévia, uma única vez, e o esconde enquanto o do rodapé está aberto', () => {
    const matches = [...source.matchAll(/<ConsentEntryBanner\b/g)]
    assert.equal(matches.length, 1)
    assert.match(source, /\{!previewOnly&&entryNoticeEnabled&&<ConsentEntryBanner marketingEnabled=\{Boolean\(metaPixelId\)\} suppressed=\{showPrivacyPreferences\}\/>\}/)
  })

  it('o aviso de entrada oferece Recusar, Aceitar métricas e Personalizar com o mesmo peso e só grava ao clicar', () => {
    const buttons = [...banner.matchAll(/<button type="button" className="cpf-entry-choice" data-choice="(\w+)" onClick=\{[^}]*\}>([^<]+)<\/button>/g)]
    assert.deepEqual(buttons.map(m => [m[1], m[2]]), [['reject', 'Recusar'], ['metrics', 'Aceitar métricas'], ['customize', 'Personalizar']])
    // Nenhum botão com classe ou estilo próprio: o mesmo peso visual para as três escolhas.
    assert.equal([...banner.matchAll(/className="cpf-entry-choice"/g)].length, 3)
    assert.equal(/Aceitar tudo|Recusar tudo/.test(banner), false, 'métricas e marketing não se misturam em um botão só')
    // Nada pré-selecionado e nenhuma gravação fora de um onClick (montar, rolar ou digitar nunca vale como aceite).
    assert.equal(/aria-pressed|defaultChecked|checked=/.test(banner), false)
    const writes = [...banner.matchAll(/setConsentChoices\(|setAnalyticsConsent\(|setMarketingConsent\(/g)]
    assert.equal(writes.length, 1)
    assert.match(banner, /const choose = \(action: EntryConsentAction\) => setConsentChoices\(entryConsentChoices\(action, marketingEnabled\)\)/)
    const effect = banner.slice(banner.indexOf('useEffect('), banner.indexOf('}, [])'))
    assert.equal(/setConsentChoices|setAnalyticsConsent|setMarketingConsent/.test(effect), false, 'o efeito de montagem só lê o cookie')
    // "Personalizar" só abre o aviso detalhado; não grava nada.
    assert.match(banner, /data-choice="customize" onClick=\{\(\) => setCustomizing\(true\)\}/)
  })

  it('em "Personalizar" o painel detalhado não some ao decidir só as métricas (marketing ainda precisa aparecer)', () => {
    const hidden = banner.indexOf('if (suppressed || consent === undefined) return null')
    const customizing = banner.indexOf('if (customizing) {')
    const pending = banner.indexOf('if (!entryConsentPending(consent)) return null')
    assert.ok(hidden >= 0 && customizing > hidden && pending > customizing, 'o painel detalhado é decidido antes da checagem de pendência')
    assert.match(css, /\[data-consent-layer=details\]:empty\{display:none\}/)
  })

  it('o aviso de entrada não bloqueia nem cobre o formulário de forma permanente', () => {
    assert.equal(/aria-modal|role="dialog"|role="alertdialog"|autoFocus|\.focus\(/.test(banner), false)
    const rule = css.match(/\.cassiellos-public-flow \.cpf-entry-consent\{[^}]*\}/)?.[0] ?? ''
    assert.match(rule, /position:sticky;bottom:0/)
    assert.equal(/position:fixed|inset:0|backdrop/.test(rule), false)
    assert.equal(/cpf-entry-consent[^{]*\{[^}]*(pointer-events:none|backdrop-filter)/.test(css), false)
  })

  it('mantém PageView e conversões da Meta dependentes de consentimento', () => {
    assert.match(source, /<MetaPixel pixelId=\{metaPixelId\}\/>/)
    assert.match(pixel, /marketingAllowed\(\)/)
    assert.match(pixel, /if \(!tracked \|\| !pixelId \|\| !granted\) return/)
  })

  it('não carrega Analytics e SpeedInsights do CRM sem permissão', () => {
    assert.match(analytics, /if \(requiresAnalyticsConsent\(pathname\) && !consented\) return null/)
  })

  it('mantém a prévia isolada, sem consentimento, Pixel ou cadastro real', () => {
    assert.match(source, /if\(previewOnly\)\{/)
    assert.match(source, /\{!previewOnly&&<MetaPixel/)
    assert.match(source, /\{!previewOnly&&<aside className="cpf-privacy-minimal"/)
    assert.match(source, /\{!previewOnly&&entryNoticeEnabled&&<ConsentEntryBanner/)
  })
})
