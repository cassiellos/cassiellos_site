import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { diagramModel,diagramPorts,validateDiagramLayout,fitDiagramCamera,removeDiagramStep } from './diagram'
import { newFlowTemplate, routeFlow, validateFlow } from './flow'

describe('Editor de fluxograma — mapa, conexões e persistência',()=>{
  const sample=()=>newFlowTemplate('Escolas')
  it('visualiza bifurcação SIM/NÃO com destino próprio, sem alterar o motor público',()=>{
    const flow=sample()
    const model=diagramModel(flow)
    assert.equal(model.nodes.length,5)
    const budget=model.nodes.find(n=>n.id==='budget')
    assert.ok(budget)
    const yes=budget.ports.find(p=>p.label==='Sim')
    const no=budget.ports.find(p=>p.label==='Não')
    assert.equal(yes?.target,'qualified')
    assert.equal(yes?.kind,'default')
    assert.equal(no?.target,'limited')
    assert.equal(no?.kind,'branch')
    assert.equal(diagramPorts(flow.steps.find(s=>s.id==='revenue') as typeof flow.steps[0] & {type:'question',next:string,branches:[],options:string[],input:'select'}).length,1)
    assert.equal(routeFlow(flow,{clinic:'Escola X',revenue:'Até R$ 10 mil',budget:'Não'})?.result.outcome,'limited')
  })
  it('organiza todos os cartões, inclusive uma etapa desconectada, sem mudar links',()=>{
    const flow=sample()
    const node=flow.steps.find(s=>s.id==='budget')
    if(!node||node.type!=='question')throw Error('missing budget')
    node.branches=[]
    const model=diagramModel(flow)
    assert.ok(model.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)))
    assert.equal(model.reachable.has('limited'),false)
    assert.equal(model.nodes.find(n=>n.id==='limited')?.depth,
      Math.max(...model.nodes.filter(n=>model.reachable.has(n.id)).map(n=>n.depth))+1)
  })
  it('enquadra o fluxo ao medir um canvas desktop e mantém algum cartão visível',()=>{
    const model=diagramModel(sample())
    const viewport={w:1200,h:610}
    const camera=fitDiagramCamera(model,viewport,'clinic')
    assert.ok(camera.zoom>=.2&&camera.zoom<=1)
    const first=model.nodes.find(n=>n.id==='clinic')!
    const sx=camera.x+first.x*camera.zoom
    const sy=camera.y+first.y*camera.zoom
    assert.ok(sx+first.w*camera.zoom>0&&sx<viewport.w)
    assert.ok(sy+first.h*camera.zoom>0&&sy<viewport.h)
    assert.ok(Number.isFinite(camera.x)&&Number.isFinite(camera.y))
  })
  it('focaliza a etapa inicial no celular quando não cabe o diagrama inteiro',()=>{
    const model=diagramModel(sample())
    const viewport={w:414,h:480}
    const camera=fitDiagramCamera(model,viewport,'clinic')
    const first=model.nodes.find(n=>n.id==='clinic')!
    const centerX=camera.x+(first.x+first.w/2)*camera.zoom
    const centerY=camera.y+(first.y+first.h/2)*camera.zoom
    assert.ok(centerX>0&&centerX<viewport.w)
    assert.ok(centerY>0&&centerY<viewport.h)
    assert.ok(camera.zoom>=.2,'mobile camera must remain navigable')
  })
  it('não enquadra fora da área mesmo com posições personalizadas extremas',()=>{
    const flow=sample()
    flow.layout={clinic:{x:-2400,y:-1800},qualified:{x:6500,y:6200}}
    const model=diagramModel(flow)
    const camera=fitDiagramCamera(model,{w:670,h:500},'clinic')
    const first=model.nodes.find(n=>n.id==='clinic')!
    assert.ok(camera.x+first.x*camera.zoom>=-first.w*camera.zoom)
    assert.ok(camera.y+first.y*camera.zoom>=-first.h*camera.zoom)
  })
  it('valida posições por ID, tamanho e faixa antes de persistir no JSONB',()=>{
    const flow=sample()
    flow.layout={budget:{x:850,y:320},limited:{x:1300,y:600}}
    const valid=validateFlow(flow)
    assert.equal(valid.ok,true)
    if(valid.ok){
      assert.deepEqual(valid.flow.layout,flow.layout)
      assert.deepEqual(diagramModel(valid.flow).nodes.find(n=>n.id==='budget')?.x,850)
    }
    flow.layout={bad:{x:1,y:2}}
    assert.equal(validateFlow(flow).ok,false)
    flow.layout={budget:{x:Infinity,y:2}}
    assert.equal(validateFlow(flow).ok,false)
    assert.equal(validateDiagramLayout({budget:{x:12.8,y:20.1}},new Set(['budget']))?.budget.x,13)
    assert.equal(validateDiagramLayout({budget:{x:100000,y:3}},new Set(['budget'])),null)
  })
  it('impede excluir resultado conectado e nunca converte Não em lead qualificado silenciosamente',()=>{
    const flow=sample()
    const before=JSON.stringify(flow)
    const denied=removeDiagramStep(flow,'limited')
    assert.equal(denied.ok,false)
    if(!denied.ok)assert.match(denied.issues.join(' '),/resposta "Não"/)
    assert.equal(JSON.stringify(flow),before)
    assert.equal(routeFlow(flow,{clinic:'Escola A',revenue:'Até R$ 10 mil',budget:'Não'})?.result.outcome,'limited')
    const budget=flow.steps.find(s=>s.id==='budget')
    if(!budget||budget.type!=='question')throw Error('missing budget')
    budget.branches=[]
    const permitted=removeDiagramStep(flow,'limited')
    assert.equal(permitted.ok,true)
    if(permitted.ok){
      assert.equal(permitted.flow.steps.some(s=>s.id==='limited'),false)
      assert.equal(validateFlow(permitted.flow).ok,true)
    }
  })
  it('troca a etapa inicial somente com confirmação explícita no editor',()=>{
    const flow=sample()
    const removal=removeDiagramStep(flow,'clinic')
    assert.equal(removal.ok,true)
    if(removal.ok){
      assert.equal(removal.startChanged,true)
      assert.equal(removal.flow.start,'revenue')
      assert.equal(validateFlow(removal.flow).ok,true)
    }
  })
  it('permite construir uma bifurcação adicional sem modificar os demais destinos',()=>{
    const flow=sample()
    const revenue=flow.steps.find(s=>s.id==='revenue')
    if(!revenue||revenue.type!=='question')throw Error('missing revenue')
    revenue.branches=[{answer:'Acima de R$ 100 mil',to:'limited'}]
    assert.equal(validateFlow(flow).ok,true)
    const edges=diagramPorts(revenue)
    assert.equal(edges.length,2)
    assert.equal(edges.find(e=>e.kind==='branch')?.target,'limited')
    assert.equal(edges.find(e=>e.kind==='default')?.options.length,4)
    assert.equal(routeFlow(flow,{clinic:'Escola X',revenue:'Acima de R$ 100 mil'})?.result.outcome,'limited')
  })
})
