import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getBookingForm, REVENUE_RANGES } from './booking-forms'

describe('booking form odontologia — faturamento em faixas', () => {
  const form = getBookingForm('odontologia')

  it('usa a versão odontologia-v2', () => {
    assert.ok(form)
    assert.equal(form.version, 'odontologia-v2')
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

  it('preserva os nomes de campo consumidos pelo CRM (clinic, revenue, priority)', () => {
    assert.deepEqual(form?.fields.map(field => field.name), ['clinic', 'revenue', 'priority'])
  })
})
