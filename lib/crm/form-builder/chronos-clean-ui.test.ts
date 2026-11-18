import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css=readFileSync(resolve(process.cwd(),'app/formularios/[slug]/public-flow.css'),'utf8')
const source=readFileSync(resolve(process.cwd(),'app/formularios/[slug]/public-flow.tsx'),'utf8')

describe('Formulário Chronos clean — contrato visual do fluxo público',()=>{
  it('mantém uma única implementação visual e não retorna ao CSS antigo sobreposto',()=>{
    assert.equal((css.match(/CHRONOS CLEAN/g)||[]).length,1)
    assert.doesNotMatch(css,/CHRONOS RESTAURADO|Capa Chronos, somente quando configurada/)
    assert.match(css,/\[data-chronos=true\]/)
  })
  it('capa usa espaços em branco, fonte leve, ênfase seletiva e botão azul compacto',()=>{
    assert.match(css,/--cpf-blue:#3b82f6/)
    assert.match(css,/\.cpf-cover h1\s*\{[^}]*font-weight:400/s)
    assert.match(css,/\.cpf-cover h1 strong\s*\{[^}]*font-weight:800/s)
    assert.match(css,/\.cpf-cover \.cpf-primary\s*\{[^}]*width:auto/s)
    assert.match(css,/\.cpf-cover \.cpf-primary\s*\{[^}]*margin-top:auto/s)
    assert.match(source,/coverHeadline\(flow\.cover\.headline\)/)
    assert.match(source,/coverCtaLabel\(flow\.cover\.cta\)/)
  })
  it('aplica o sistema a perguntas, alternativas, contatos e finalizações sem mudar o fluxo',()=>{
    for(const name of ['.cpf-question','.cpf-options','.cpf-contact','.cpf-result','.cpf-step-marker']){
      assert.ok(css.includes(name),'missing visual style '+name)
    }
    assert.match(source,/data-screen=\{coverOpen\?/)
    assert.match(source,/validateBrazilianMobilePhone\(freeText\)/)
    assert.match(source,/trackMetaConversion\('Lead'/)
  })
  it('preserva logo no mobile, responsividade e preferências de cookies recolhidas',()=>{
    assert.match(css,/@media\(max-width:620px\)/)
    assert.match(css,/\.cpf-header\s*\{\s*height:64px;[^}]*display:flex/s)
    assert.match(source,/\[showPrivacyPreferences,setShowPrivacyPreferences\]=useState\(false\)/)
    assert.match(source,/showPrivacyPreferences&&<ConsentNotice/)
  })
})
