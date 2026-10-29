import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeLeadEmail, planLeadMerge, type StoredLeadContact } from './lead-intake'

const stored: StoredLeadContact = {
  full_name: 'Maria Souza', whatsapp: '31988887777', company: 'Clínica Sorriso', segment: 'Clínicas odontológicas',
}

describe('planLeadMerge — formulário público não sobrescreve cadastro', () => {
  it('campos preenchidos e diferentes são preservados e apenas sinalizados', () => {
    const plan = planLeadMerge(stored, {
      full_name: 'Outra Pessoa', whatsapp: '31911112222', company: 'Outra Clínica', segment: 'Outro nicho',
    })
    assert.deepEqual(plan.updates, {})
    assert.deepEqual(plan.filledFields, [])
    assert.deepEqual(plan.differingFields, ['full_name', 'whatsapp', 'company', 'segment'])
  })

  it('mesmos dados (variações de caixa, espaços e máscara de telefone) não geram divergência', () => {
    const plan = planLeadMerge(stored, {
      full_name: '  maria   SOUZA ', whatsapp: '(31) 98888-7777', company: 'clínica sorriso', segment: 'Clínicas odontológicas',
    })
    assert.deepEqual(plan, { updates: {}, filledFields: [], differingFields: [] })
  })

  it('preenche somente campos realmente vazios (null ou só espaços)', () => {
    const plan = planLeadMerge(
      { full_name: 'Maria Souza', whatsapp: null, company: '   ', segment: 'Clínicas odontológicas' },
      { full_name: 'Maria S.', whatsapp: '31900000000', company: ' Clínica Nova ', segment: 'Outro' },
    )
    assert.deepEqual(plan.updates, { whatsapp: '31900000000', company: 'Clínica Nova' })
    assert.deepEqual(plan.filledFields, ['whatsapp', 'company'])
    assert.deepEqual(plan.differingFields, ['full_name', 'segment'])
  })

  it('valores novos vazios nunca apagam dados existentes', () => {
    const plan = planLeadMerge(stored, { full_name: '', whatsapp: null, company: '  ', segment: null })
    assert.deepEqual(plan, { updates: {}, filledFields: [], differingFields: [] })
  })
})

describe('normalizeLeadEmail', () => {
  it('remove espaços e usa minúsculas', () => {
    assert.equal(normalizeLeadEmail('  Lead.Real@Cassiellos.COM.br '), 'lead.real@cassiellos.com.br')
  })
})
