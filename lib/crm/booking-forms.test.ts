import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getBookingForm, REVENUE_RANGES, isValidWebPresence } from './booking-forms'

describe('booking form odontologia — faturamento em faixas', () => {
  const form = getBookingForm('odontologia')

  it('usa a versão odontologia-v4 (textos definitivos; mesmos campos e opções da v3)', () => {
    assert.ok(form)
    assert.equal(form.version, 'odontologia-v4')
  })

  it('textos públicos sem conteúdo provisório, depoimentos, resultados ou valores não comprovados', () => {
    assert.ok(form)
    const texts = [form.eyebrow, form.headline, form.description, form.cta, form.meetingName, ...form.highlights,
      ...form.fields.flatMap(field => [field.label, field.placeholder ?? '', ...(field.options ?? [])])]
    for (const text of texts) {
      assert.equal(/[\[\]]/.test(text), false, 'colchetes provisórios: ' + text)
      assert.equal(/\((depoimentos|perfil de cliente ideal|resultado ou diferencial comprovado)\)/i.test(text), false, text)
      assert.equal(/depoimento|garantid|comprovad/i.test(text), false, 'afirmação não comprovada: ' + text)
    }
    assert.equal(form.highlights.length, 3)
    assert.ok(form.highlights.some(item => item.includes(form.durationMinutes + ' minutos')), 'duração coerente com a reunião')
  })

  it('pergunta de orçamento mantém as opções Sim/Não sem citar valor mínimo', () => {
    const budget = form?.fields.find(field => field.name === 'budget')
    assert.ok(budget)
    assert.deepEqual(budget.options, ['Sim', 'Não'])
    assert.equal(budget.required, true)
    assert.equal(/R\$|\d/.test(budget.label), false, budget.label)
  })

  it('revenue é seleção obrigatória com as 7 faixas aprovadas, na ordem', () => {
    const revenue = form?.fields.find(field => field.name === 'revenue')
    assert.ok(revenue)
    assert.equal(revenue.type, 'select')
    assert.equal(revenue.required, true)
    assert.deepEqual(revenue.options, [
      'Ainda não faturo',
      'Até R$ 10 mil/mês',
      'De R$ 10 mil a R$ 30 mil/mês',
      'De R$ 30 mil a R$ 50 mil/mês',
      'De R$ 50 mil a R$ 100 mil/mês',
      'De R$ 100 mil a R$ 300 mil/mês',
      'Acima de R$ 300 mil/mês',
    ])
  })

  it('cada faixa passa nos limites de validação do servidor (2 a 120 caracteres, sem caracteres de controle)', () => {
    for (const option of REVENUE_RANGES) {
      assert.ok(option.length >= 2 && option.length <= 120, option)
      assert.equal(option, option.trim())
      assert.ok(!/[\u0000-\u001f\u007f]/.test(option), option)
    }
  })

  it('configura o novo funil sem alterar dados de contato do CRM', () => {
    assert.deepEqual(form?.fields.map(field => field.name), ['instagram', 'revenue', 'budget'])
  })
})

describe('presença digital — site ou Instagram', () => {
  it('aceita domínios, URLs e usernames sem arroba', () => {
    for (const text of ['cassiellos.com.br','https://cassiellos.com.br',
      'www.cassiellos.com.br', 'cassiellos.agencia', '@cassiellos.agencia',
      'https://www.instagram.com/cassiellos.agencia/']) {
      assert.equal(isValidWebPresence(text), true, text)
    }
  })
  it('rejeita esquemas inseguros e espaços', () => {
    for (const text of ['javascript:alert(1)','http://localhost/path',
      'site com espaços', 'https://foo@bar.com', 'http://192.168.1.1']) {
      assert.equal(isValidWebPresence(text), false, text)
    }
  })
})
