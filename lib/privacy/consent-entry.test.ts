import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseConsent, serializeConsent } from './consent'
import { entryConsentChoices, entryConsentPending } from './consent-entry'

const state = (analytics: boolean | null, marketing: boolean | null) =>
  parseConsent(serializeConsent({ analytics, marketing }, new Date('2026-11-24T12:00:00Z')))

describe('aviso de consentimento da entrada do formulário', () => {
  it('aparece sem escolha de métricas e some depois dela; marketing nunca segura nem fecha o aviso', () => {
    assert.equal(entryConsentPending(null), true)
    assert.equal(entryConsentPending(state(true, null)), false)
    assert.equal(entryConsentPending(state(false, null)), false)
    assert.equal(entryConsentPending(state(true, false)), false)
    assert.equal(entryConsentPending(state(false, true)), false)
    // Só marketing decidido (por exemplo pelo rodapé): a escolha de métricas ainda falta.
    assert.equal(entryConsentPending(state(null, true)), true)
    assert.equal(entryConsentPending(state(null, false)), true)
  })

  it('"Aceitar métricas" grava SÓ métricas, com ou sem Meta Pixel na página: marketing nunca é ligado por ele', () => {
    assert.deepEqual(entryConsentChoices('accept-metrics', true), { analytics: true })
    assert.deepEqual(entryConsentChoices('accept-metrics', false), { analytics: true })
    for (const marketingEnabled of [true, false]) {
      assert.equal('marketing' in entryConsentChoices('accept-metrics', marketingEnabled), false)
    }
  })

  it('"Recusar" recusa tudo o que é opcional na página e nunca grava categoria que a página não usa', () => {
    assert.deepEqual(entryConsentChoices('reject', true), { analytics: false, marketing: false })
    assert.deepEqual(entryConsentChoices('reject', false), { analytics: false })
  })

  it('nenhuma ação devolve concessão de marketing', () => {
    for (const action of ['reject', 'accept-metrics'] as const) {
      for (const marketingEnabled of [true, false]) {
        assert.notEqual(entryConsentChoices(action, marketingEnabled).marketing, true, action)
      }
    }
  })
})
