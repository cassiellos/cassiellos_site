import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acceptFailure, acceptResponse, beginRequest, initialState, requestKey } from './client-state'
import type { IntelFilters } from './view-types'

const f = (o: Partial<IntelFilters>): IntelFilters => ({ area: 'cliente', period: '30d', platform: 'all', status: 'all', client: 'cli_demo_a', campaign: '', ...o })

describe('Central — estado da interface na troca de cliente', () => {
  it('trocar de cliente apaga imediatamente os dados do cliente anterior', () => {
    let s = initialState<{ owner: string }>()
    s = beginRequest(s, f({}))
    s = acceptResponse(s, requestKey(f({})), { owner: 'A' })
    assert.equal(s.data?.owner, 'A')
    s = beginRequest(s, f({ client: 'cli_demo_b' }))
    assert.equal(s.data, null, 'nada do cliente A fica na tela enquanto B carrega')
    assert.equal(s.status, 'loading')
  })
  it('resposta atrasada de outro cliente é ignorada', () => {
    let s = beginRequest(initialState<{ owner: string }>(), f({}))
    const keyA = requestKey(f({}))
    s = beginRequest(s, f({ client: 'cli_demo_b' }))
    s = acceptResponse(s, keyA, { owner: 'A' }) // chegou depois da troca
    assert.equal(s.data, null)
    assert.equal(s.status, 'loading')
    s = acceptResponse(s, requestKey(f({ client: 'cli_demo_b' })), { owner: 'B' })
    assert.equal(s.data?.owner, 'B')
    assert.equal(acceptFailure(s, keyA, 'error', 'X'), s, 'falha antiga também é ignorada')
  })
  it('mudar só o período mantém os dados do mesmo cliente enquanto carrega', () => {
    let s = acceptResponse(beginRequest(initialState<{ owner: string }>(), f({})), requestKey(f({})), { owner: 'A' })
    s = beginRequest(s, f({ period: '7d' }))
    assert.equal(s.data?.owner, 'A')
  })
  it('sessão expirada descarta os dados', () => {
    let s = acceptResponse(beginRequest(initialState<{ owner: string }>(), f({})), requestKey(f({})), { owner: 'A' })
    s = beginRequest(s, f({ period: '7d' }))
    s = acceptFailure(s, requestKey(f({ period: '7d' })), 'unauthorized', 'UNAUTHORIZED')
    assert.equal(s.data, null)
  })
})
