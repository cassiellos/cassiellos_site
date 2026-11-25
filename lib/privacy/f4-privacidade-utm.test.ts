import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, it } from 'node:test'
import {
  KNOWN_UTM_MEDIUMS, KNOWN_UTM_SOURCES, UTM_KEYS, attributionFromSearch, ga4PageLocation, looksLikePersonalData,
  sanitizeExtendedValue, sanitizeUtmField, sanitizeUtmValue, type UtmKey,
} from './url-sanitize'
import { sanitizeAttribution } from '../crm/attribution'
import { clean } from '../crm/booking-intake-request'

const BASE = 'https://crm.cassiellos.com.br/formularios/hamburguerias'
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const locationSource = read('docs/tracking/gtm/page-location-sanitizado.js')
const attributionSource = read('docs/tracking/gtm/atribuicao-parametro.js')

/** Dados pessoais que NÃO podem chegar ao GA4, ao CRM nem ao AnalyticsFlow em nenhum campo de texto de UTM. */
const PERSONAL = [
  // telefones
  '31999990000', '(31) 99999-0000', '(31)99999-0000', '31 99999-0000', '31 9 9999 0000', '+55 31 99999-0000', '+5531999990000', '5531999990000',
  '55 (31) 99999 0000', '55-31-99999-0000', '99999-0000', '3199999-0000', '3133334444', '(31) 3333-4444', '0800 123 4567',
  // CPF / CNPJ / CEP / RG-like
  '12345678909', '123.456.789-09', '123 456 789 09', '12345678000195', '12.345.678/0001-95', '30140-071', '30140-0710',
  // e-mail e @usuario
  'maria@clinica.com.br', 'maria%40clinica.com.br', '@maria.silva', 'maria @ clinica',
  // misturas com texto
  'promo 31999990000', 'ligar (31) 99999-0000 hoje', 'cpf 123.456.789-09', 'campanha_5531999990000_final',
  // rede / URL / códigos opacos
  '192.168.0.1', 'ip 10.0.0.255 teste', 'http://exemplo.com/a', 'https://exemplo.com?x=1', 'www.exemplo.com', '//exemplo.com',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef1234567890',
  // chave que NÃO é de ID não protege número pessoal
  'tel-31999990000', 'cpf-12345678909', 'fone-5531999990000',
]
/** Valores legítimos do padrão de UTMs (v1/v2) e do anúncio: precisam sobreviver. */
const LEGIT_FREE = [
  'SC | C01 | VENDAS | HAMBURGUERIAS | AGENDAMENTOS', 'SC | A01', 'SC | CJ01', 'diagnostico_odontologia_2026-11', 'black_friday_2026-11-25',
  'Promoção (100%)!', 'agencia_marketing_odontologico', 'agencia de marketing', 'hamburguerias_sp_v2', 'video_depoimento_v2',
  'cid-120211234567890123__asid-120211234567890234__ad-120211234567890456', 'cid-22334455667__agid-145678901234__ad-678901234567',
  'cid-22334455667__agid-145678901234__ad-678901234567__cr-video_depoimento_v2',
  'diagnostico_estrategico_hamburguerias_sp_2026_11_vendas_agendamentos', // 66 caracteres: nome longo não é "código opaco"
  '120211234567890123', // ID de plataforma de 18 dígitos
]
const ID_OK = ['120211234567890123', '23843000000000000', '120210000000000001', 'cid-22334455667', 'ad-678901234567', 'asid-120211234567890234']
const ID_BAD = [
  '31999990000', '5531999990000', '12345678909', '12345678000195', '30140071', 'abc', '120211234567890123x', '1202112345678901234567890',
  'cpf-12345678909', 'tel-31999990000', 'fone-31999990000', 'maria@x.com', '(31) 99999-0000', '123.456.789-09', 'cid-123',
]

const SOURCE_TOKENS = ['meta', 'Meta', 'facebook', 'instagram', 'google', 'newsletter', 'parceiro_clinica_x', 'site', 'ig', 'fb']
const MEDIUM_TOKENS = ['paid_social', 'cpc', 'organic_social', 'referral', 'email', 'messaging', 'paid', 'email_marketing']

describe('F4 — UTMs: nenhum telefone, CPF, CNPJ, CEP, e-mail, IP, URL ou código opaco chega ao destino', () => {
  it('todos os campos de texto de UTM descartam dados pessoais reconhecíveis por formato', () => {
    for (const key of UTM_KEYS) for (const value of PERSONAL) {
      assert.equal(sanitizeUtmField(key, value), '', `${key}=${value}`)
    }
    for (const value of PERSONAL) assert.equal(looksLikePersonalData(value), true, value)
  })

  it('valores legítimos do padrão (nomes de campanha, IDs com chave, IDs de plataforma) são preservados', () => {
    for (const value of LEGIT_FREE) {
      for (const key of ['utm_campaign', 'utm_content', 'utm_term'] as const) assert.equal(sanitizeUtmField(key, value), value, `${key}=${value}`)
      assert.equal(sanitizeUtmValue(value), value)
    }
  })

  it('origem e meio: uma palavra bem formada (ou conhecida); nome com espaço, sobrenome ou número pessoal não passa', () => {
    for (const v of SOURCE_TOKENS) assert.equal(sanitizeUtmField('utm_source', v), v, v)
    for (const v of MEDIUM_TOKENS) assert.equal(sanitizeUtmField('utm_medium', v), v, v)
    for (const v of ['Maria Silva', 'maria silva santos', 'meta ads', '1meta', '_meta', 'x'.repeat(41), '31999990000', 'a@b.com']) {
      assert.equal(sanitizeUtmField('utm_source', v), '', `utm_source=${v}`)
      assert.equal(sanitizeUtmField('utm_medium', v), '', `utm_medium=${v}`)
    }
    for (const known of KNOWN_UTM_SOURCES) assert.equal(sanitizeUtmField('utm_source', known), known)
    for (const known of KNOWN_UTM_MEDIUMS) assert.equal(sanitizeUtmField('utm_medium', known), known)
    assert.ok(KNOWN_UTM_SOURCES.includes('meta') && KNOWN_UTM_MEDIUMS.includes('paid_social'), 'o par do anúncio (v2) é conhecido')
  })

  it('IDs de campanha, conjunto e anúncio: só 15–20 dígitos ou chave explícita (cid, agid, asid, adid, ad, adset, cmp) + número', () => {
    for (const key of ['utm_id', 'adset_id', 'ad_id'] as const) {
      for (const v of ID_OK) assert.equal(sanitizeExtendedValue(key, v), v, `${key}=${v}`)
      for (const v of ID_BAD) assert.equal(sanitizeExtendedValue(key, v), '', `${key}=${v}`)
    }
    assert.equal(sanitizeExtendedValue('placement', 'Instagram_Reels'), 'Instagram_Reels')
    assert.equal(sanitizeExtendedValue('placement', 'Instagram 31999990000'), '')
    assert.equal(sanitizeExtendedValue('placement', 'Instagram (31) 99999-0000'), '')
    assert.equal(sanitizeExtendedValue('utm_source_platform', 'Meta'), 'meta')
  })

  it('o mesmo filtro vale no navegador (cadastro), no servidor e no page_location do GA4', () => {
    const search = (key: UtmKey, value: string) => '?' + new URLSearchParams({ [key]: value }).toString()
    for (const value of PERSONAL) {
      assert.deepEqual(attributionFromSearch(search('utm_campaign', value), { allowFbclid: false }), {}, value)
      assert.deepEqual(sanitizeAttribution({ utm_campaign: value, utm_content: value, utm_term: value, utm_source: value, utm_medium: value }, clean), {}, value)
      assert.equal(ga4PageLocation(`${BASE}${search('utm_content', value)}`), BASE, value)
    }
    assert.deepEqual(
      attributionFromSearch('?utm_source=meta&utm_medium=paid_social&utm_campaign=SC%20%7C%20C01&utm_content=31999990000&utm_term=maria%40x.com', { allowFbclid: false }),
      { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'SC | C01' },
    )
  })

  it('LIMITE CONHECIDO (documentado): nome próprio em texto livre de campanha/conteúdo/termo não é reconhecível por regex', () => {
    assert.equal(sanitizeUtmField('utm_campaign', 'Maria Silva'), 'Maria Silva', 'só origem e meio exigem uma palavra; texto livre depende de quem monta o link')
    assert.equal(sanitizeUtmField('utm_source', 'Maria Silva'), '')
  })
})

describe('F4 — as variáveis JavaScript do GTM dão o MESMO resultado que o código do site', () => {
  function runLocation(url: string): string {
    const u = new URL(url)
    const sandbox = { window: { location: { href: u.href, protocol: u.protocol, host: u.host, pathname: u.pathname, search: u.search } } }
    return vm.runInNewContext(`(${locationSource})()`, sandbox) as string
  }
  function runAttribution(key: string, search: string): string | undefined {
    const source = attributionSource.replace("var KEY = 'adset_id';", `var KEY = '${key}';`)
    return vm.runInNewContext(`(${source})()`, { window: { location: { search } } }) as string | undefined
  }

  it('page_location: cada valor pessoal/legítimo em cada chave de UTM e estendida (TypeScript × GTM)', () => {
    const values = [...PERSONAL, ...LEGIT_FREE, ...SOURCE_TOKENS, ...MEDIUM_TOKENS, ...ID_OK, ...ID_BAD, 'Maria Silva', 'Instagram_Reels', 'Meta']
    const keys = [...UTM_KEYS, 'utm_id', 'utm_source_platform', 'adset_id', 'ad_id', 'placement']
    let compared = 0
    for (const key of keys) for (const value of values) {
      const url = `${BASE}?${new URLSearchParams({ [key]: value }).toString()}`
      assert.equal(runLocation(url), ga4PageLocation(url), `${key}=${value}`)
      compared++
    }
    assert.ok(compared > 800, 'corpus grande o bastante: ' + compared)
  })

  it('atribuição por chave (adset_id, ad_id, placement): o GTM devolve o mesmo que o cadastro, ou undefined', () => {
    for (const key of ['adset_id', 'ad_id', 'placement'] as const) {
      for (const value of [...ID_OK, ...ID_BAD, ...PERSONAL, 'Instagram_Reels', 'Instagram Reels', 'Facebook_Mobile_Feed']) {
        const expected = sanitizeExtendedValue(key, value)
        const got = runAttribution(key, '?' + new URLSearchParams({ [key]: value }).toString())
        assert.equal(got ?? '', expected, `${key}=${value}`)
      }
    }
  })

  it('o anúncio v2 completo (string preparada, não aplicada) atravessa intacto no GTM e no site', () => {
    // Ordem canônica de saída: cinco UTMs e, depois, utm_id, utm_source_platform, adset_id, ad_id, placement.
    const full = 'utm_source=meta&utm_medium=paid_social&utm_campaign=SC+%7C+C01+%7C+VENDAS+%7C+HAMBURGUERIAS+%7C+AGENDAMENTOS'
      + '&utm_content=SC+%7C+A01&utm_term=SC+%7C+CJ01&utm_id=120210000000000001&utm_source_platform=meta&adset_id=120210000000000002&ad_id=120210000000000003&placement=Instagram_Reels'
    assert.equal(ga4PageLocation(`${BASE}?${full}`), `${BASE}?${full}`)
    assert.equal(runLocation(`${BASE}?${full}`), `${BASE}?${full}`)
    assert.equal(Object.keys(attributionFromSearch('?' + full, { allowFbclid: false })).length, 10, 'as 10 chaves chegam ao cadastro')
  })

  it('o texto das variáveis não usa recursos fora do ES5 (compatível com o GTM)', () => {
    for (const source of [locationSource, attributionSource]) {
      assert.doesNotMatch(source, /=>|\blet\b|\bconst\b|`|\(\?<[=!]|\.\.\.|\bof\b\s/, 'sem arrow, let/const, template, lookbehind ou spread')
    }
  })
})
