import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseConsent, serializeConsent } from './consent'
import { entryConsentChoices, entryConsentPending } from './consent-entry'

const state = (analytics: boolean | null, marketing: boolean | null) =>
  parseConsent(serializeConsent({ analytics, marketing }, new Date('2026-11-24T12:00:00Z')))

describe('aviso de consentimento da entrada do formulário', () => {
  it('aparece sem escolha e some depois de decidido; categoria que não existe na página não segura o aviso', () => {
    assert.equal(entryConsentPending(null, false), true)
    assert.equal(entryConsentPending(null, true), true)
    // Só métricas decididas.
    assert.equal(entryConsentPending(state(true, null), false), false)
    assert.equal(entryConsentPending(state(false, null), false), false)
    // Com o Meta Pixel habilitado, falta decidir marketing.
    assert.equal(entryConsentPending(state(true, null), true), true)
    assert.equal(entryConsentPending(state(true, false), true), false)
    assert.equal(entryConsentPending(state(false, true), true), false)
    // Marketing decidido, métricas pendentes.
    assert.equal(entryConsentPending(state(null, true), true), true)
  })

  it('"Aceitar tudo" e "Recusar tudo" gravam só as categorias que a página usa', () => {
    assert.deepEqual(entryConsentChoices('accept-all', true), { analytics: true, marketing: true })
    assert.deepEqual(entryConsentChoices('reject-all', true), { analytics: false, marketing: false })
    assert.deepEqual(entryConsentChoices('accept-all', false), { analytics: true })
    assert.deepEqual(entryConsentChoices('reject-all', false), { analytics: false })
    // Nunca devolve escolhas para sinais de anúncio do Google nem para categorias inexistentes.
    assert.deepEqual(Object.keys(entryConsentChoices('accept-all', true)).sort(), ['analytics', 'marketing'])
  })
})
