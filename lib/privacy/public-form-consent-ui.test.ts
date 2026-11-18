import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

/**
 * Protege a entrada clean do formulário público: mudanças de consentimento
 * não podem reintroduzir banners antes da primeira pergunta.
 * A renderização do Pixel e das métricas permanece condicionada à permissão.
 */
describe('Regressão — formulário público sem avisos intrusivos na abertura', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/formularios/[slug]/public-flow.tsx'), 'utf8')
  const pixel = readFileSync(resolve(process.cwd(), 'components/marketing/meta-pixel.tsx'), 'utf8')
  const analytics = readFileSync(resolve(process.cwd(), 'components/analytics-privacy.tsx'), 'utf8')

  it('começa com preferências recolhidas e só monta ConsentNotice por interação explícita', () => {
    assert.match(source, /\[showPrivacyPreferences,setShowPrivacyPreferences\]=useState\(false\)/)
    const matches = [...source.matchAll(/<ConsentNotice\s+marketingEnabled=/g)]
    assert.equal(matches.length, 1, 'não deve haver aviso adicional no início do formulário')
    assert.match(source, /showPrivacyPreferences&&<ConsentNotice\s+marketingEnabled=/)
    assert.match(source, /onClick=\{\(\)=>setShowPrivacyPreferences\(current=>!current\)\}/)
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
  })
})
