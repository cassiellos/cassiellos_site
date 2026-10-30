import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CLICK_ID_PARAMS, analyticsUrl, isClickIdParam, originAndPath, sanitizeUtmValue, utmFromSearch } from './url-sanitize'
import { isCrmScopePath } from './scope'

const LANDING = 'https://cassiellos.com.br/contato?utm_source=google&utm_medium=cpc&utm_campaign=22334455667' +
  '&utm_term=agencia+de+marketing&gclid=Cj0KCQjw-SECRET&fbclid=IwAR-SECRET&msclkid=abc&gbraid=0AA&lang=en#form'

describe('privacidade — funções base (sem efeito até ligar as chaves dos grupos)', () => {
  it('analyticsUrl: remove identificadores, outros parâmetros e fragmento; mantém UTMs', () => {
    assert.equal(analyticsUrl(LANDING), 'https://cassiellos.com.br/contato?utm_source=google&utm_medium=cpc&utm_campaign=22334455667&utm_term=agencia+de+marketing')
    assert.equal(analyticsUrl('https://cassiellos.com.br/'), 'https://cassiellos.com.br/')
  })
  it('UTM: e-mail descartado; IDs numéricos preservados; controles e tamanho', () => {
    assert.equal(sanitizeUtmValue('maria@clinica.com.br'), '')
    assert.equal(sanitizeUtmValue('lista-maria%40clinica.com'), '')
    assert.equal(sanitizeUtmValue('22334455667'), '22334455667')
    assert.equal(sanitizeUtmValue('  black_friday\u0000 '), 'black_friday')
    assert.equal(sanitizeUtmValue('x'.repeat(250)).length, 200)
    assert.deepEqual(utmFromSearch('?utm_source=newsletter&utm_content=joao@ex.com&utm_medium=email'), { utm_source: 'newsletter', utm_medium: 'email' })
  })
  it('originAndPath e identificadores de clique', () => {
    assert.equal(originAndPath(LANDING), 'https://cassiellos.com.br/contato')
    assert.equal(originAndPath('javascript:alert(1)'), '')
    for (const id of ['gclid', 'GCLID', 'fbclid', 'wbraid', 'ttclid']) assert.equal(isClickIdParam(id), true, id)
    assert.ok(CLICK_ID_PARAMS.includes('gclid'))
  })
  it('escopo: CRM (funil e painel) × site institucional', () => {
    for (const p of ['/agendar/odontologia', '/agendar', '/crm', '/crm/login', '/mini-crm']) assert.equal(isCrmScopePath(p), true, p)
    for (const p of ['/', '/sobre', '/en', '/politica-de-privacidade', '/agendamento', '/crmx']) assert.equal(isCrmScopePath(p), false, p)
  })
})
