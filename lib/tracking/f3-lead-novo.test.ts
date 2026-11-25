import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { isNewLeadResponse, leadOutcomeOf } from './lead-outcome'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('F3 — só um lead NOVO registrado pelo servidor gera generate_lead', () => {
  it('o servidor classifica: novo, recadastro (e-mail existente) e repetição idempotente', () => {
    assert.equal(leadOutcomeOf({ reused: false, resubmitted: false }), 'new')
    assert.equal(leadOutcomeOf({ reused: false, resubmitted: true }), 'resubmitted')
    assert.equal(leadOutcomeOf({ reused: true, resubmitted: false }), 'reused')
    assert.equal(leadOutcomeOf({ reused: true, resubmitted: true }), 'reused')
  })

  it('o navegador conta só `leadOutcome: "new"` com ok verdadeiro; qualquer outra coisa não conta', () => {
    assert.equal(isNewLeadResponse({ ok: true, leadOutcome: 'new', reused: false }), true)
    assert.equal(isNewLeadResponse({ ok: true, leadOutcome: 'new', leadMode: 'test' }), true, 'lead de teste novo é lead novo (modo test)')
    assert.equal(isNewLeadResponse({ ok: true, leadOutcome: 'resubmitted', reused: false }), false, 'recadastro: antes contava, agora não')
    assert.equal(isNewLeadResponse({ ok: true, leadOutcome: 'reused', reused: true }), false)
    assert.equal(isNewLeadResponse({ ok: true, reused: false }), false, 'servidor antigo/sem classificação: na dúvida, não conta')
    assert.equal(isNewLeadResponse({ ok: false, leadOutcome: 'new' }), false)
    for (const bad of [null, undefined, 'new', 1, [], { ok: 'true', leadOutcome: 'new' }, { ok: true, leadOutcome: 'NEW' }, { ok: true, leadOutcome: ['new'] }]) {
      assert.equal(isNewLeadResponse(bad), false, JSON.stringify(bad))
    }
  })

  it('no código: a rota informa leadOutcome; o formulário usa a decisão do servidor; a Meta segue a regra de antes', () => {
    const route = read('app/api/public/forms/[slug]/route.ts')
    assert.match(route, /leadOutcome:leadOutcomeOf\(saved\)/)
    assert.match(route, /const leadEventId=!saved\.reused&&!saved\.resubmitted&&saved\.isTest===false&&marketing\.consent/, 'CAPI: regra comercial intacta')
    assert.match(route, /saved\.reused\?200:201/, 'status HTTP intacto')
    const flow = read('app/formularios/[slug]/public-flow.tsx')
    assert.match(flow, /if\(isNewLeadResponse\(data\)\)track\('generate_lead'/)
    assert.doesNotMatch(flow, /reused!==true\)track\('generate_lead'/)
    assert.match(flow, /if\(data\?\.reused!==true && data\?\.tracking\?\.lead\?\.eventName==='Lead'\)\{\s*trackMetaConversion\('Lead',data\.tracking\.lead\.eventId/, 'Pixel da Meta: mesma condição e mesmo event_id de antes')
    assert.match(flow, /track\('generate_lead',\{\.\.\.contactAt,environment_mode:previewOnly\?'preview':serverMode\?\?mode\},idempotencyKey\.current\)/, 'chave de deduplicação do navegador intacta')
  })
})
