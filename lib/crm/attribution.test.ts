import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attributionChannel, CHANNEL_LABELS, sanitizeAttribution } from './attribution'
import { clean } from './booking-intake-request'

describe('atribuição — padrão de UTMs (U1–U5)', () => {
  it('reconhece os padrões aprovados', () => {
    assert.equal(attributionChannel('google', 'cpc'), 'google_ads')
    assert.equal(attributionChannel('meta', 'paid_social'), 'meta_ads')
    assert.equal(attributionChannel('instagram', 'organic_social'), 'instagram_organic')
    assert.equal(attributionChannel('facebook', 'organic_social'), 'facebook_organic')
    assert.equal(attributionChannel('parceiro_clinica_exemplo', 'referral'), 'partner')
    assert.equal(attributionChannel('whatsapp', 'messaging'), 'whatsapp')
    assert.equal(attributionChannel(null, null), 'direct')
  })
  it('fora do padrão aparece como tal (não é reclassificado)', () => {
    assert.equal(attributionChannel('instagram', 'paid_social'), 'other')
    assert.equal(attributionChannel('meta', 'cpc'), 'other')
    assert.equal(attributionChannel('parceiro_', 'referral'), 'other')
    assert.equal(attributionChannel('parceiro_clinica', 'cpc'), 'other')
    assert.equal(CHANNEL_LABELS.other, 'Fora do padrão de UTMs')
  })
  it('leitura tolerante a maiúsculas, sem alterar o valor gravado', () => {
    assert.equal(attributionChannel('Google', 'CPC'), 'google_ads')
    assert.deepEqual(sanitizeAttribution({ utm_source: 'Google', utm_medium: 'CPC' }, clean), { utm_source: 'Google', utm_medium: 'CPC' })
  })
})

describe('atribuição — gravação (mesma estrutura, mesmas chaves)', () => {
  it('mantém UTMs legítimos do padrão e fbclid; ignora gclid e chaves desconhecidas', () => {
    const value = sanitizeAttribution({
      utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'diagnostico_odontologia_2026-11',
      utm_content: 'cid-120211234567890123__asid-120211234567890234__ad-120211234567890456', utm_term: 'agencia_marketing',
      fbclid: 'IwAR0abc', gclid: 'G1', email: 'x@y.com',
    }, clean)
    assert.deepEqual(value, {
      utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'diagnostico_odontologia_2026-11',
      utm_content: 'cid-120211234567890123__asid-120211234567890234__ad-120211234567890456', utm_term: 'agencia_marketing',
      fbclid: 'IwAR0abc',
    })
  })
  it('descarta UTM com aparência de e-mail (inclusive %40) e valores longos', () => {
    assert.deepEqual(sanitizeAttribution({
      utm_source: 'email', utm_content: 'maria@clinica.com.br', utm_term: 'maria%40clinica.com.br', utm_campaign: 'x'.repeat(181),
    }, clean), { utm_source: 'email' })
  })
  it('entrada inválida = atribuição vazia', () => {
    for (const raw of [null, 'utm_source=meta', ['meta'], 7]) assert.deepEqual(sanitizeAttribution(raw, clean), {})
  })
})
