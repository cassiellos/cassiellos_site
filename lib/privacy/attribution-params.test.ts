import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attributionFromSearch, sanitizeExtendedValue } from './url-sanitize'
import { sanitizeAttribution } from '../crm/attribution'
import { clean } from '../crm/booking-intake-request'

// Link no formato da proposta v2 (nomes e IDs ilustrativos; nenhum dado real).
const META_V2 = '?utm_source=meta&utm_medium=paid_social&utm_campaign=SC%20%7C%20C01%20%7C%20VENDAS' +
  '&utm_id=120211234567890123&utm_content=SC%20%7C%20A01&utm_term=SC%20%7C%20CJ01&utm_source_platform=meta' +
  '&adset_id=120211234567890234&ad_id=120211234567890456&placement=Instagram_Reels'

describe('atribuição estendida (padrão UTM v2) — navegador', () => {
  it('preserva UTMs, IDs permanentes, plataforma e posicionamento', () => {
    assert.deepEqual(attributionFromSearch(META_V2, { allowFbclid: false }), {
      utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'SC | C01 | VENDAS', utm_content: 'SC | A01', utm_term: 'SC | CJ01',
      utm_id: '120211234567890123', utm_source_platform: 'meta', adset_id: '120211234567890234', ad_id: '120211234567890456',
      placement: 'Instagram_Reels',
    })
  })
  it('parâmetro repetido: vale a primeira ocorrência', () => {
    assert.equal(attributionFromSearch('?utm_source=meta&utm_source=outro&ad_id=120211234567890456&ad_id=999999999999999', { allowFbclid: false }).utm_source, 'meta')
    assert.equal(attributionFromSearch('?ad_id=120211234567890456&ad_id=999999999999999', { allowFbclid: false }).ad_id, '120211234567890456')
  })
  it('fbclid só com consentimento; demais identificadores de clique e parâmetros desconhecidos nunca saem', () => {
    const url = '?utm_source=meta&fbclid=F1&gclid=G1&gbraid=B1&wbraid=W1&msclkid=M1&ttclid=T1&yclid=Y1&igshid=I1&email=a@b.com&nome=Maria'
    assert.deepEqual(attributionFromSearch(url, { allowFbclid: false }), { utm_source: 'meta' })
    assert.deepEqual(attributionFromSearch(url, { allowFbclid: true }), { utm_source: 'meta', fbclid: 'F1' })
  })
  it('sem parâmetros: atribuição vazia', () => {
    assert.deepEqual(attributionFromSearch('', { allowFbclid: true }), {})
  })
})

describe('atribuição estendida — formato estrito e dados pessoais', () => {
  it('IDs: só 15 a 20 dígitos ou chave-número; telefone, CPF, CNPJ e CEP são descartados', () => {
    for (const bad of ['31999990000', '5531999990000', '12345678909', '12345678000195', '30140071', 'abc', '120211234567890123x', '1202112345678901234567890']) {
      assert.equal(sanitizeExtendedValue('ad_id', bad), '', bad)
    }
    for (const ok of ['120211234567890123', '23843000000000000', 'cid-22334455667', 'ad-678901234567']) assert.equal(sanitizeExtendedValue('utm_id', ok), ok)
  })
  it('e-mail em qualquer parâmetro estendido é descartado', () => {
    for (const key of ['utm_id', 'utm_source_platform', 'adset_id', 'ad_id', 'placement'] as const) {
      assert.equal(sanitizeExtendedValue(key, 'maria@clinica.com.br'), '', key)
      assert.equal(sanitizeExtendedValue(key, 'maria%40clinica.com.br'), '', key)
    }
  })
  it('plataforma em minúsculas e posicionamento legível; script e símbolos são descartados', () => {
    assert.equal(sanitizeExtendedValue('utm_source_platform', 'Meta'), 'meta')
    assert.equal(sanitizeExtendedValue('utm_source_platform', 'meta ads'), '')
    assert.equal(sanitizeExtendedValue('placement', 'Facebook_Mobile_Feed'), 'Facebook_Mobile_Feed')
    assert.equal(sanitizeExtendedValue('placement', 'Instagram Reels'), 'Instagram Reels')
    assert.equal(sanitizeExtendedValue('placement', '<script>alert(1)</script>'), '')
    assert.equal(sanitizeExtendedValue('placement', 'x'.repeat(61)), '')
  })
})

describe('atribuição estendida — servidor (mesma estrutura de gravação)', () => {
  it('grava os parâmetros estendidos válidos e ignora os inválidos; gclid continua não coletado', () => {
    const value = sanitizeAttribution({
      utm_source: 'meta', utm_medium: 'paid_social', utm_id: '120211234567890123', utm_source_platform: 'meta',
      adset_id: '120211234567890234', ad_id: '31999990000', placement: 'Instagram_Reels', fbclid: 'IwAR0abc', gclid: 'G1', foo: 'bar',
    }, clean)
    assert.deepEqual(value, {
      utm_source: 'meta', utm_medium: 'paid_social', utm_id: '120211234567890123', utm_source_platform: 'meta',
      adset_id: '120211234567890234', placement: 'Instagram_Reels', fbclid: 'IwAR0abc',
    })
  })
  it('o servidor também confere o formato, mesmo que o navegador seja adulterado', () => {
    assert.deepEqual(sanitizeAttribution({ ad_id: 'maria@x.com', adset_id: '5531999990000', utm_id: '1', placement: '<b>' }, clean), {})
  })
  it('estrutura anterior intacta: sem os novos parâmetros o resultado é o mesmo de antes', () => {
    assert.deepEqual(sanitizeAttribution({ utm_source: 'google', utm_medium: 'cpc', fbclid: 'F' }, clean), { utm_source: 'google', utm_medium: 'cpc', fbclid: 'F' })
  })
})
