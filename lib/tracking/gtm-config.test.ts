import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getGtmFormConfig } from './gtm-config'

describe('configuração do GTM do formulário', () => {
  it('desligado por padrão e com qualquer configuração incompleta', () => {
    assert.deepEqual(getGtmFormConfig({}), { enabled: false })
    assert.deepEqual(getGtmFormConfig({ GTM_FORM_CONTAINER_ID: 'GTM-ABC1234' }), { enabled: false })
    assert.deepEqual(getGtmFormConfig({ TRACKING_GTM_ENABLED: 'true' }), { enabled: false })
    assert.deepEqual(getGtmFormConfig({ TRACKING_GTM_ENABLED: 'TRUE', GTM_FORM_CONTAINER_ID: 'GTM-ABC1234' }), { enabled: false })
  })
  it('rejeita IDs que não sejam de container GTM (inclusive um ID do GA4)', () => {
    for (const id of ['G-ABCDEF1234', 'GTM-', 'GTM-AB', 'GTM-ab cd', '<script>', 'GTM-ABCDEFGHIJKLM']) {
      assert.deepEqual(getGtmFormConfig({ TRACKING_GTM_ENABLED: 'true', GTM_FORM_CONTAINER_ID: id }), { enabled: false }, id)
    }
  })
  it('liga só com a chave expressa e um ID válido', () => {
    assert.deepEqual(getGtmFormConfig({ TRACKING_GTM_ENABLED: 'true', GTM_FORM_CONTAINER_ID: ' gtm-abc1234 ' }),
      { enabled: true, containerId: 'GTM-ABC1234' })
  })
})
