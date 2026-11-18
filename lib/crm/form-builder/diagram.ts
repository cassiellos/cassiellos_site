import type { FlowDefinition, FlowQuestion, FlowStep } from './flow'

/**
 * Diagrama é uma visualização da MESMA definição de fluxo utilizada pelo servidor.
 * Conexão padrão agrupa alternativas sem desvio explícito, para não desenhar 12
 * linhas sobrepostas para a mesma etapa.
 */
export type DiagramPort = {
  key: string
  source: string
  target: string
  label: string
  answer: string | null
  kind: 'default' | 'branch'
  options: string[]
}
export type DiagramPoint = { x: number; y: number }
export type DiagramNode = { id: string; step: FlowStep; x: number; y: number; w: number; h: number; ports: DiagramPort[]; depth: number }
export type DiagramModel = { nodes: DiagramNode[]; ports: DiagramPort[]; width: number; height: number; minX: number; minY: number; reachable: Set<string> }
export const NODE_WIDTH = 268
const COLUMN_GAP = 165
const ROW_GAP = 64
export const PORT_TOP = 106
export const PORT_HEIGHT = 33

export function diagramPorts(step: FlowQuestion): DiagramPort[] {
  const branches = step.input === 'select' ? step.branches : []
  const remainder = step.input === 'select'
    ? step.options.filter(v => !branches.some(b => b.answer === v))
    : []
  const list: DiagramPort[] = []
  if (step.input === 'text' || remainder.length > 0) {
    const label = step.input === 'text' ? 'Continuar'
      : remainder.length === 1 ? remainder[0]
      : remainder.length === step.options.length ? 'Todas as respostas'
      : 'Outras respostas (' + remainder.length + ')'
    list.push({ key:step.id+':default',source:step.id,target:step.next,label,
      answer:null,kind:'default',options:remainder })
  }
  for (const b of branches) {
    list.push({key:step.id+':'+b.answer,source:step.id,target:b.to,label:b.answer,
      answer:b.answer,kind:'branch',options:[b.answer]})
  }
  return list
}

function nodeHeight(step: FlowStep, ports: DiagramPort[]): number {
  return step.type === 'result' ? 154 : Math.max(164, PORT_TOP + ports.length * PORT_HEIGHT + 38)
}

export function diagramModel(flow: FlowDefinition): DiagramModel {
  const steps = flow.steps
  const byId = new Map(steps.map(s => [s.id,s]))
  const portBySource = new Map<string,DiagramPort[]>()
  const ports: DiagramPort[] = []
  for (const step of steps) {
    if (step.type !== 'question') continue
    const group = diagramPorts(step)
    portBySource.set(step.id,group)
    ports.push(...group)
  }
  // Breadth-first reachability and topological layers from actual (effective) edges.
  // Any invalid cycle remains drawable but is rejected by the server validator.
  const reachable = new Set<string>()
  const queue = [flow.start]
  while (queue.length && reachable.size <= 32) {
    const id = queue.shift()!
    if (reachable.has(id) || !byId.has(id)) continue
    reachable.add(id)
    for (const edge of portBySource.get(id)||[]) if (!reachable.has(edge.target)) queue.push(edge.target)
  }
  const indegree = new Map(steps.map(s => [s.id,0]))
  for (const edge of ports) if (indegree.has(edge.target)) indegree.set(edge.target,(indegree.get(edge.target)||0)+1)
  const depth = new Map<string,number>(steps.map(s => [s.id,0]))
  const topo = steps.filter(s=>(indegree.get(s.id)||0)===0).map(s=>s.id)
  for(let i=0;i<topo.length && i<=steps.length;i++){
    const id=topo[i]
    for(const edge of portBySource.get(id)||[]){
      if(!indegree.has(edge.target))continue
      depth.set(edge.target,Math.max(depth.get(edge.target)||0,(depth.get(id)||0)+1))
      const n=(indegree.get(edge.target)||0)-1
      indegree.set(edge.target,n)
      if(n===0)topo.push(edge.target)
    }
  }
  const maxReachable=Math.max(0,...[...reachable].map(id=>depth.get(id)||0))
  for(const step of steps)if(!reachable.has(step.id))depth.set(step.id,maxReachable+1)

  const layers = new Map<number, FlowStep[]>()
  for(const step of steps){
    const d=Math.min(steps.length+1,depth.get(step.id)||0)
    layers.set(d,[...(layers.get(d)||[]),step])
  }
  // Keep the author's order inside a level; vertically center shorter columns.
  const heights=new Map<number,number>()
  for(const [d,group] of layers){
    heights.set(d,group.reduce((total,s,i)=>total+nodeHeight(s,portBySource.get(s.id)||[])+(i?ROW_GAP:0),0))
  }
  const maxHeight=Math.max(440,...heights.values())
  const nodes:DiagramNode[]=[]
  for(const [d,group] of [...layers.entries()].sort((a,b)=>a[0]-b[0])){
    let y=90+(maxHeight-(heights.get(d)||0))/2
    for(const step of group){
      const h=nodeHeight(step,portBySource.get(step.id)||[])
      const pos=flow.layout?.[step.id]
      const custom=pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      nodes.push({id:step.id,step,w:NODE_WIDTH,h,depth:d,
        x:custom?pos.x:86+d*(NODE_WIDTH+COLUMN_GAP),
        y:custom?pos.y:y,
        ports:portBySource.get(step.id)||[]})
      y+=h+ROW_GAP
    }
  }
  const minX=Math.min(0,...nodes.map(n=>n.x))-24
  const minY=Math.min(0,...nodes.map(n=>n.y))-24
  const maxX=Math.max(700,...nodes.map(n=>n.x+n.w))+100
  const maxY=Math.max(480,...nodes.map(n=>n.y+n.h))+100
  return {nodes,ports,minX,minY,width:Math.max(720,maxX-minX),height:Math.max(520,maxY-minY),reachable}
}

/** Gravações de layout têm limite para não permitir dados gigantes ou deslocamentos infinitos. */
export function validateDiagramLayout(raw: unknown, ids: Set<string>): Record<string, DiagramPoint>|null {
  if (raw === undefined) return {}
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const data=raw as Record<string,unknown>
  if(Object.keys(data).length>24 || Object.keys(data).some(id=>!ids.has(id)))return null
  const result:Record<string,DiagramPoint>={}
  for(const [id,value] of Object.entries(data)){
    if(!value||typeof value!=='object'||Array.isArray(value))return null
    const v=value as Record<string,unknown>
    if(Object.keys(v).some(k=>k!=='x'&&k!=='y')||typeof v.x!=='number'||typeof v.y!=='number'
      ||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>7000||Math.abs(v.y)>7000)return null
    result[id]={x:Math.round(v.x),y:Math.round(v.y)}
  }
  return result
}


/**
 * Exclusão conservadora: nunca reescreve implicitamente o destino de uma resposta.
 * Uma etapa referenciada deve ser desconectada/redirecionada explicitamente antes.
 */
export type StepRemoval =
  | { ok: true; flow: FlowDefinition; startChanged: boolean }
  | { ok: false; issues: string[] }

export function removeDiagramStep(flow: FlowDefinition,id: string): StepRemoval {
  const step=flow.steps.find(s=>s.id===id)
  if(!step)return {ok:false,issues:['Etapa não encontrada.']}
  if(flow.steps.length<=2)return {ok:false,issues:['O fluxo precisa manter pelo menos duas etapas.']}
  const links:string[]=[]
  for(const source of flow.steps){
    if(source.id===id||source.type!=='question')continue
    if(source.next===id)links.push('destino padrão de "'+source.title+'"')
    for(const branch of source.branches)if(branch.to===id)
      links.push('resposta "'+branch.answer+'" de "'+source.title+'"')
  }
  if(links.length)return {ok:false,issues:[
    'Esta etapa recebe '+links.length+' conexão(ões). Redirecione-as antes de excluir: '+links.join('; ')+'.'
  ]}
  const startChanged=flow.start===id
  if(startChanged&&(step.type!=='question'||!flow.steps.some(s=>s.id===step.next)))
    return {ok:false,issues:['Configure um próximo destino válido para a etapa inicial antes de excluí-la.']}
  const layout=flow.layout?{...flow.layout}:undefined
  if(layout)delete layout[id]
  return {ok:true,startChanged,flow:{
    start:startChanged&&step.type==='question'?step.next:flow.start,
    steps:flow.steps.filter(s=>s.id!==id),
    ...(layout===undefined?{}:{layout}),
  }}
}

/**
 * Camera inicial calculada somente após medir o viewport REAL do canvas.
 * Quando o fluxo não cabe nem no zoom mínimo (especialmente no celular),
 * focaliza a primeira etapa em vez de posicionar o grafo inteiro fora da tela.
 * Independente de DOM para permitir teste da matemática em Node.
 */
export type DiagramCamera = { x: number; y: number; zoom: number }
export function fitDiagramCamera(model:DiagramModel,viewport:{w:number;h:number},startId:string,minZoom=.2):DiagramCamera {
  const w=Math.max(1,viewport.w),h=Math.max(1,viewport.h)
  const zoom=Math.min(1,Math.max(minZoom,Math.min((w-48)/model.width,(h-52)/model.height)))
  const allFit=model.width*zoom<=w-12 && model.height*zoom<=h-12
  if(allFit){
    return {zoom,x:(w-model.width*zoom)/2-model.minX*zoom,y:(h-model.height*zoom)/2-model.minY*zoom}
  }
  const first=model.nodes.find(n=>n.id===startId)||model.nodes[0]
  if(!first)return {zoom,x:24,y:24}
  return {zoom,x:w/2-(first.x+first.w/2)*zoom,y:h/2-(first.y+first.h/2)*zoom}
}


/**
 * Zoom no ponto sob o cursor (trackpad, roda com Ctrl/⌘ ou gesto do Safari).
 * Não depende do navegador: mantém o mesmo ponto do diagrama debaixo do cursor,
 * inclusive quando o fator atinge os limites de zoom.
 */
export function zoomDiagramCameraAt(
  camera: DiagramCamera, factor: number, anchor: { x: number; y: number },
  minZoom = .2, maxZoom = 3,
): DiagramCamera {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return camera
  }
  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom * factor))
  const xInWorld = (anchor.x - camera.x) / camera.zoom
  const yInWorld = (anchor.y - camera.y) / camera.zoom
  return {
    zoom,
    x: anchor.x - xInWorld * zoom,
    y: anchor.y - yInWorld * zoom,
  }
}
