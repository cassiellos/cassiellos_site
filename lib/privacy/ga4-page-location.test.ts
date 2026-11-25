import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { ga4PageLocation, ga4PageReferrer } from './url-sanitize'

const BASE = 'https://crm.cassiellos.com.br/formularios/hamburguerias'
const FULL = 'utm_source=meta&utm_medium=paid_social&utm_campaign=SC+%7C+C01+%7C+VENDAS&utm_content=SC+%7C+A01&utm_term=SC+%7C+CJ01'
  + '&utm_id=120210000000000001&utm_source_platform=meta&adset_id=120210000000000002&ad_id=120210000000000003&placement=Instagram_Reels'

const CASES: Array<{ nome: string; url: string; allowGoogle?: boolean; esperado: string }> = [
  { nome: 'sem consulta: igual à origem + caminho', url: BASE, esperado: BASE },
  { nome: 'link completo do anúncio: preserva todas as chaves de atribuição', url: `${BASE}?${FULL}`, esperado: `${BASE}?${FULL}` },
  { nome: 'fbclid e outros identificadores de clique saem', url: `${BASE}?utm_source=meta&fbclid=IwAR0abc&msclkid=zzz&ttclid=t1&_gl=1*abc&igshid=x&utm_medium=paid_social`, esperado: `${BASE}?utm_source=meta&utm_medium=paid_social` },
  { nome: 'gclid e companhia saem por padrão (sem Google Ads)', url: `${BASE}?gclid=Cj0KCQiAabc123&gbraid=0AAAAA1234&wbraid=abcdef12&gad_source=1&gad_campaignid=123&utm_source=google&utm_medium=cpc`, esperado: `${BASE}?utm_source=google&utm_medium=cpc` },
  { nome: 'gclid passa SOMENTE com a opção futura ligada', url: `${BASE}?gclid=Cj0KCQiAabc123&utm_source=google&utm_medium=cpc`, allowGoogle: true, esperado: `${BASE}?utm_source=google&utm_medium=cpc&gclid=Cj0KCQiAabc123` },
  { nome: 'com a opção ligada, identificador malformado continua fora', url: `${BASE}?gclid=a%40b.com&utm_source=google`, allowGoogle: true, esperado: `${BASE}?utm_source=google` },
  { nome: 'parâmetros desconhecidos (nome, e-mail, telefone) saem', url: `${BASE}?nome=Maria&email=maria%40exemplo.com&telefone=31999990000&utm_source=meta`, esperado: `${BASE}?utm_source=meta` },
  { nome: 'UTM com e-mail é descartada, as demais ficam', url: `${BASE}?utm_source=meta&utm_campaign=maria%40exemplo.com&utm_medium=paid_social`, esperado: `${BASE}?utm_source=meta&utm_medium=paid_social` },
  { nome: 'ID de plataforma fora do formato (telefone/CPF) é descartado', url: `${BASE}?utm_id=31999990000&adset_id=12345678901&ad_id=120210000000000003`, esperado: `${BASE}?ad_id=120210000000000003` },
  { nome: 'primeira ocorrência vale', url: `${BASE}?utm_source=meta&utm_source=outra&utm_medium=paid_social`, esperado: `${BASE}?utm_source=meta&utm_medium=paid_social` },
  { nome: 'fragmento sai', url: `${BASE}?utm_source=meta#email=maria@exemplo.com`, esperado: `${BASE}?utm_source=meta` },
  { nome: 'acentos e símbolos viram a mesma codificação do navegador', url: `${BASE}?utm_campaign=Promo%C3%A7%C3%A3o+(100%25)!`, esperado: `${BASE}?utm_campaign=Promo%C3%A7%C3%A3o+%28100%25%29%21` },
  { nome: 'placement inválido é descartado', url: `${BASE}?placement=%3Cscript%3E&utm_source_platform=Meta`, esperado: `${BASE}?utm_source_platform=meta` },
]

describe('page_location do GA4: só origem, caminho e chaves de atribuição válidas', () => {
  for (const c of CASES) {
    it(c.nome, () => {
      assert.equal(ga4PageLocation(c.url, { allowGoogleClickIds: c.allowGoogle }), c.esperado)
    })
  }

  it('não-URL e esquemas fora de http(s) voltam inalterados', () => {
    assert.equal(ga4PageLocation('isso não é url'), 'isso não é url')
    assert.equal(ga4PageLocation('javascript:alert(1)'), 'javascript:alert(1)')
  })

  it('page_referrer: origem + caminho, sem consulta nem fragmento', () => {
    assert.equal(ga4PageReferrer('https://l.instagram.com/?u=https%3A%2F%2Fcrm.cassiellos.com.br&e=AT0token'), 'https://l.instagram.com/')
    assert.equal(ga4PageReferrer('https://www.google.com/search?q=maria%40exemplo.com#x'), 'https://www.google.com/search')
    assert.equal(ga4PageReferrer(''), '')
    assert.equal(ga4PageReferrer('android-app://com.instagram.android'), '')
  })
})

describe('variáveis do GTM (texto em docs/tracking/gtm) produzem o mesmo resultado das funções do site', () => {
  const locationSource = readFileSync(resolve(process.cwd(), 'docs/tracking/gtm/page-location-sanitizado.js'), 'utf8')
  const referrerSource = readFileSync(resolve(process.cwd(), 'docs/tracking/gtm/page-referrer-sanitizado.js'), 'utf8')

  function runLocation(url: string, allowGoogle = false): string {
    const u = new URL(url)
    const source = allowGoogle ? locationSource.replace('var ALLOW_GOOGLE_CLICK_IDS = false;', 'var ALLOW_GOOGLE_CLICK_IDS = true;') : locationSource
    const sandbox = { window: { location: { href: u.href, protocol: u.protocol, host: u.host, pathname: u.pathname, search: u.search } } }
    return vm.runInNewContext(`(${source})()`, sandbox) as string
  }

  for (const c of CASES) {
    it(`GTM: ${c.nome}`, () => {
      assert.equal(runLocation(c.url, Boolean(c.allowGoogle)), c.esperado)
      assert.equal(runLocation(c.url, Boolean(c.allowGoogle)), ga4PageLocation(c.url, { allowGoogleClickIds: c.allowGoogle }))
    })
  }

  it('GTM: o interruptor de identificadores do Google vem DESLIGADO no arquivo versionado', () => {
    assert.match(locationSource, /var ALLOW_GOOGLE_CLICK_IDS = false;/)
  })

  it('GTM: variável de atribuição por chave devolve o mesmo que o cadastro (ou undefined)', () => {
    const source = readFileSync(resolve(process.cwd(), 'docs/tracking/gtm/atribuicao-parametro.js'), 'utf8')
    const run = (key: string, search: string) => vm.runInNewContext(`(${source.replace("var KEY = 'adset_id';", `var KEY = '${key}';`)})()`, { window: { location: { search } } }) as string | undefined
    assert.equal(run('adset_id', '?utm_source=meta&adset_id=120210000000000002'), '120210000000000002')
    assert.equal(run('ad_id', '?ad_id=120210000000000003&ad_id=outro'), '120210000000000003')
    assert.equal(run('placement', '?placement=Instagram_Reels'), 'Instagram_Reels')
    assert.equal(run('adset_id', '?adset_id=31999990000'), undefined, 'telefone não é ID de plataforma')
    assert.equal(run('placement', '?placement=maria%40exemplo.com'), undefined)
    assert.equal(run('ad_id', ''), undefined)
    assert.match(source, /var KEY = 'adset_id';/, 'o arquivo versionado traz uma chave de exemplo')
  })

  it('GTM: referenciador', () => {
    const run = (referrer: string) => vm.runInNewContext(`(${referrerSource})()`, { document: { referrer } }) as string | undefined
    assert.equal(run('https://l.instagram.com/?u=x&e=AT0token'), 'https://l.instagram.com/')
    assert.equal(run('https://www.google.com/search?q=a#b'), 'https://www.google.com/search')
    assert.equal(run(''), undefined)
  })
})
