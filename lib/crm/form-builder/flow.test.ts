import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { newFlowTemplate,routeFlow,safeFlowHref,validFlowSlug,validateFlow } from './flow'

describe('editor de formulários — grafo e rotas seguras',()=>{
  const example=()=>newFlowTemplate('Escolas')
  it('modelo inicial tem bifurcação Sim/Não e resultados diferentes',()=>{
    const flow=example()
    assert.equal(validateFlow(flow).ok,true)
    const qualified=routeFlow(flow,{clinic:'Escola A',revenue:'Até R$ 10 mil',budget:'Sim'})
    const limited=routeFlow(flow,{clinic:'Escola B',revenue:'Até R$ 10 mil',budget:'Não'})
    assert.equal(qualified?.result.outcome,'qualified')
    assert.equal(limited?.result.outcome,'limited')
    assert.deepEqual(qualified?.path,['clinic','revenue','budget','qualified'])
    assert.deepEqual(limited?.path,['clinic','revenue','budget','limited'])
  })
  it('não aceita uma rota escolhida pelo visitante nem respostas de outra bifurcação',()=>{
    const flow=example()
    assert.equal(routeFlow(flow,{clinic:'Escola A',revenue:'Até R$ 10 mil',budget:'Inexistente'}),null)
    assert.equal(routeFlow(flow,{clinic:'Escola A',revenue:'Até R$ 10 mil',budget:'Não',forged:'qualified'}),null)
    assert.equal(routeFlow(flow,{clinic:'Escola A',budget:'Sim'}),null)
    assert.equal(routeFlow(flow,{clinic:'Escola A',revenue:'Até R$ 10 mil',budget:'Sim',limited:'Sim'}),null)
  })
  it('editores não conseguem criar ciclos nem etapas desconectadas',()=>{
    const flow=example()
    const q=flow.steps.find(s=>s.id==='budget')
    assert.ok(q&&q.type==='question')
    if(q.type!=='question')return
    q.next='clinic'
    const checked=validateFlow(flow)
    assert.equal(checked.ok,false)
    if(!checked.ok)assert.match(checked.issues.join(' '),/ciclo/i)
  })
  it('exige destinos válidos e bloqueia URLs externas/javascript:',()=>{
    assert.equal(safeFlowHref('/agendar'),true)
    assert.equal(safeFlowHref('//site-externo.test'),false)
    assert.equal(safeFlowHref('javascript:alert(1)'),false)
    assert.equal(validFlowSlug('formulario-escolas'),true)
    assert.equal(validFlowSlug('..'),false)
    const flow=example()
    const end=flow.steps.find(s=>s.id==='limited')
    if(!end||end.type!=='result')throw Error('missing result')
    end.actionHref='javascript:alert(1)'
    assert.equal(validateFlow(flow).ok,false)
  })
  it('rejeita opções duplicadas, ramificações inválidas e etapas em excesso',()=>{
    const f=example()
    const q=f.steps.find(s=>s.id==='budget')
    if(!q||q.type!=='question')throw Error('missing budget')
    q.options=['Sim','Sim']
    assert.equal(validateFlow(f).ok,false)
    const next=example()
    const b=next.steps.find(s=>s.id==='budget')
    if(!b||b.type!=='question')throw Error('missing budget')
    b.branches.push({answer:'Nunca',to:'limited'})
    assert.equal(validateFlow(next).ok,false)
    const oversized=example()
    for(let i=0;i<30;i++)oversized.steps.push({...oversized.steps[0],id:'new_'+i} as typeof oversized.steps[number])
    assert.equal(validateFlow(oversized).ok,false)
  })
})
