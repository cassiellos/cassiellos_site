import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { HAMBURGUERIAS_CHRONOS_DRAFT as flow } from './hamburguerias'
import { routeFlow,validateFlow } from './flow'

const base={name:'Ana Silva',phone:'(31) 99999-4321',web:'@hamburgueria.teste'}
describe('Hamburguerias — modelo Chronos e bifurcações',()=>{
  it('capa direta com três benefícios, filtro e CTA do curso',()=>{
    assert.equal(validateFlow(flow).ok,true)
    assert.equal(flow.cover?.bullets.length,3)
    assert.match(flow.cover?.headline||'',/^🍔 Tráfego pago/)
    assert.equal(flow.cover?.cta,'QUERO VENDER MAIS')
    assert.ok((flow.cover?.headline.split(/\s+/).length||0)<=10)
    assert.equal(flow.steps.filter(s=>s.type==='question').length,5)
  })
  it('5 faixas obrigatórias e mínimo de verba separado da gestão',()=>{
    const revenue=flow.steps.find(s=>s.id==='revenue')
    const budget=flow.steps.find(s=>s.id==='budget')
    if(revenue?.type!=='question'||budget?.type!=='question')throw Error('missing')
    assert.deepEqual(revenue.options,[
      'De R$ 30 mil a R$ 39 mil','De R$ 40 mil a R$ 49 mil',
      'De R$ 50 mil a R$ 59 mil','De R$ 60 mil a R$ 99 mil','R$ 100 mil ou mais'])
    assert.equal(revenue.required,true)
    assert.equal(budget.required,true)
    assert.match(budget.description,/não inclui os serviços de gestão/)
  })
  it('receita 30–39k vai para alternativa sem agenda, preservando dados',()=>{
    const routed=routeFlow(flow,{...base,revenue:'De R$ 30 mil a R$ 39 mil'})
    assert.equal(routed?.result.outcome,'limited')
    assert.deepEqual(routed?.path,['name','phone','web','revenue','limited'])
  })
  it('receita a partir de 40k + verba Sim segue ao agendamento',()=>{
    const answers={...base,revenue:'De R$ 40 mil a R$ 49 mil',budget:'Sim'}
    const routed=routeFlow(flow,answers)
    assert.equal(routed?.result.outcome,'qualified')
    assert.equal(routed?.result.actionHref,'/agendar')
    assert.deepEqual(routed?.path,['name','phone','web','revenue','budget','qualified'])
  })
  it('verba Não segue a nutrição e não força agendamento',()=>{
    const routed=routeFlow(flow,{...base,revenue:'R$ 100 mil ou mais',budget:'Não'})
    assert.equal(routed?.result.outcome,'limited')
    assert.deepEqual(routed?.path,['name','phone','web','revenue','budget','limited'])
  })
  it('bloqueia telefone, site ou respostas forjadas',()=>{
    const good={...base,revenue:'De R$ 60 mil a R$ 99 mil',budget:'Sim'}
    assert.equal(routeFlow(flow,{...good,phone:'1234'}),null)
    assert.equal(routeFlow(flow,{...good,web:'https://localhost'}),null)
    assert.equal(routeFlow(flow,{...good,budget:'Talvez'}),null)
    assert.equal(routeFlow(flow,{...good,revenue:'De R$ 30 mil a R$ 39 mil'}),null)
    const invalid=structuredClone(flow)
    invalid.cover!.bullets=['a'] as unknown as [string,string,string]
    assert.equal(validateFlow(invalid).ok,false)
  })
})
