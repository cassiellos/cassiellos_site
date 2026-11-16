/**
 * Motor determinístico do construtor de formulários. Os dados do visitante nunca
 * escolhem o destino por conta própria: o backend recalcula todo o percurso.
 * Rascunhos ficam separados da versão publicada.
 */
import { validateDiagramLayout } from './diagram'

export type FlowOutcome = 'qualified' | 'limited' | 'other'
export type FlowCover = { headline: string; bullets: [string,string,string]; qualifier: string; cta: string }
export type FlowQuestion = {
  id: string
  type: 'question'
  title: string
  description: string
  input: 'text' | 'select'
  /** Formato semântico opcional; formulários anteriores continuam com texto livre. */
  field?: 'name' | 'phone' | 'website'
  required: boolean
  options: string[]
  next: string
  branches: { answer: string; to: string }[]
}
export type FlowResult = {
  id: string
  type: 'result'
  title: string
  description: string
  outcome: FlowOutcome
  actionLabel: string
  actionHref: string
}
export type FlowStep = FlowQuestion | FlowResult
export type FlowDefinition = { start: string; steps: FlowStep[]; cover?: FlowCover; layout?: Record<string, { x: number; y: number }> }
export type FlowDocument = {
  id: string; title: string; slug: string; description: string; status: 'draft' | 'published'
  revision: number; publishedVersion: number; draft: FlowDefinition; published: FlowDefinition | null
  publishedMeta: { title: string; description: string } | null
  createdAt: string; updatedAt: string
}

export const FLOW_MAX_STEPS = 24
const ID = /^[a-z][a-z0-9_]{1,39}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const plain = (s: unknown, limit: number): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= limit

export function validFlowSlug(slug: unknown): slug is string {
  return plain(slug, 70) && SLUG.test(slug)
}
export function safeFlowHref(href: unknown): href is string {
  return typeof href === 'string' && (href === '' || (href.startsWith('/') && !href.startsWith('//') && !/[\\\u0000-\u001f]/.test(href)))
}
export type FlowValidation = { ok: true; flow: FlowDefinition } | { ok: false; issues: string[] }

export function validateFlow(raw: unknown): FlowValidation {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['Definição inválida.'] }
  const f = raw as Record<string, unknown>
  if (!Array.isArray(f.steps) || f.steps.length < 2 || f.steps.length > FLOW_MAX_STEPS) return { ok: false, issues: ['O fluxo precisa ter de 2 a 24 etapas.'] }
  if (typeof f.start !== 'string' || !ID.test(f.start)) problems.push('A etapa inicial é inválida.')
  let cover:FlowCover|undefined
  if (f.cover !== undefined) {
    const c=f.cover
    if(!c||typeof c!=='object'||Array.isArray(c)) problems.push('Capa do formulário inválida.')
    else {
      const v=c as Record<string,unknown>
      if(!plain(v.headline,160)||!plain(v.cta,60)||!plain(v.qualifier,240)||
        !Array.isArray(v.bullets)||v.bullets.length!==3||v.bullets.some(b=>!plain(b,100))) {
        problems.push('Headline, destaques ou botão da capa inválidos.')
      }else cover={headline:v.headline as string,bullets:v.bullets as [string,string,string],qualifier:v.qualifier as string,cta:v.cta as string}
    }
  }
  const ids = new Set<string>()
  const steps: FlowStep[] = []
  for (const [i, item] of f.steps.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { problems.push('Etapa ' + (i + 1) + ' inválida.'); continue }
    const s = item as Record<string, unknown>
    if (!plain(s.id, 40) || !ID.test(s.id) || ids.has(s.id)) { problems.push('IDs de etapas inválidos ou duplicados.'); continue }
    ids.add(s.id)
    if (!plain(s.title, 160) || typeof s.description !== 'string' || s.description.length > 500) {
      problems.push('Título ou descrição inválidos em ' + s.id); continue
    }
    if (s.type === 'result') {
      if (!['qualified', 'limited', 'other'].includes(String(s.outcome)) || typeof s.actionLabel !== 'string' ||
          s.actionLabel.length > 100 || !safeFlowHref(s.actionHref)) {
        problems.push('Resultado ou destino inválido em ' + s.id); continue
      }
      steps.push({ id: s.id, type: 'result', title: s.title, description: s.description, outcome: s.outcome as FlowOutcome,
        actionLabel: s.actionLabel, actionHref: s.actionHref as string })
    } else if (s.type === 'question') {
      if (!['text', 'select'].includes(String(s.input)) ||
          (s.field !== undefined && !['name','phone','website'].includes(String(s.field))) ||
          (s.field !== undefined && s.input !== 'text') || typeof s.required !== 'boolean' ||
          typeof s.next !== 'string' || !Array.isArray(s.branches) || s.branches.length > 12) {
        problems.push('Pergunta inválida em ' + s.id); continue
      }
      const options = s.options
      if (!Array.isArray(options) || (s.input === 'select' && (options.length < 2 || options.length > 12)) ||
          (s.input === 'text' && options.length !== 0) ||
          options.some(v => !plain(v, 80)) || new Set(options).size !== options.length) {
        problems.push('Alternativas inválidas em ' + s.id); continue
      }
      const branches: { answer: string; to: string }[] = []
      const seen = new Set<string>()
      for (const b of s.branches) {
        if (!b || typeof b.answer !== 'string' || typeof b.to !== 'string' || !options.includes(b.answer) ||
            seen.has(b.answer) || s.input !== 'select') {
          problems.push('Bifurcação inválida em ' + s.id); continue
        }
        seen.add(b.answer)
        branches.push({ answer: b.answer, to: b.to })
      }
      steps.push({ id: s.id, type: 'question', title: s.title, description: s.description,
        input: s.input as 'select' | 'text', ...(s.field === undefined ? {} : {field:s.field as FlowQuestion['field']}),
        required: s.required, options: options as string[],
        next: s.next, branches })
    } else problems.push('Tipo de etapa inválido em ' + s.id)
  }
  if (problems.length) return { ok: false, issues: [...new Set(problems)] }
  const byId = new Map(steps.map(s => [s.id, s]))
  if (!byId.has(f.start as string)) problems.push('A etapa inicial não existe.')
  if (![...byId.values()].some(s => s.type === 'result')) problems.push('É necessário pelo menos um resultado final.')
  for (const s of steps) {
    if (s.type !== 'question') continue
    if (!byId.has(s.next)) problems.push('O próximo passo de ' + s.id + ' não existe.')
    for (const b of s.branches) if (!byId.has(b.to)) problems.push('O destino de ' + s.id + ' não existe.')
  }
  if (problems.length) return { ok: false, issues: [...new Set(problems)] }
  // Every reachable path must terminate in a result; cycles are rejected even on fallback edges.
  const visited = new Set<string>()
  const stack = new Set<string>()
  const visit = (id: string): boolean => {
    if (stack.has(id)) { problems.push('Há um ciclo no fluxo: ' + id); return false }
    if (visited.has(id)) return true
    const s = byId.get(id)!
    stack.add(id)
    if (s.type === 'question') {
      const covered = s.input === 'select' && s.options.every(value => s.branches.some(b => b.answer === value))
      for (const next of [...(covered ? [] : [s.next]), ...s.branches.map(b => b.to)]) visit(next)
    }
    stack.delete(id)
    visited.add(id)
    return true
  }
  visit(f.start as string)
  if (visited.size !== steps.length) problems.push('Há etapas desconectadas da jornada.')
  const layout = validateDiagramLayout(f.layout, ids)
  if (layout === null) problems.push('Posições do fluxograma inválidas.')
  return problems.length ? { ok: false, issues: [...new Set(problems)] } :
    { ok: true, flow: { start: f.start as string, steps, ...(cover ? {cover} : {}), ...(f.layout === undefined ? {} : { layout: layout! }) } }
}

export type RoutedAnswers = { result: FlowResult; path: string[]; answers: Record<string, string> }
export function routeFlow(flow: FlowDefinition, rawAnswers: unknown): RoutedAnswers | null {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return null
  const input = rawAnswers as Record<string, unknown>
  const byId = new Map(flow.steps.map(s => [s.id, s]))
  const visited = new Set<string>()
  const path: string[] = []
  const accepted: Record<string, string> = {}
  let id = flow.start
  while (id && !visited.has(id) && path.length <= FLOW_MAX_STEPS) {
    const step = byId.get(id)
    if (!step) return null
    visited.add(id); path.push(id)
    if (step.type === 'result') {
      // Reject malicious extra answers that weren't shown on the chosen branch.
      if (Object.keys(input).some(k => !(k in accepted))) return null
      return { result: step, path, answers: accepted }
    }
    const raw = input[step.id]
    const answer = typeof raw === 'string' ? raw.trim() : ''
    if ((step.required && answer.length < 2) || answer.length > 160 || (step.input === 'select' && !step.options.includes(answer))) return null
    accepted[step.id] = answer
    id = step.branches.find(b => b.answer === answer)?.to || step.next
  }
  return null
}

export function newFlowTemplate(name: string): FlowDefinition {
  return { start: 'clinic', steps: [
    { id: 'clinic', type: 'question', title: 'Qual é o nome do seu negócio?', description: 'Queremos conhecer sua operação.', input: 'text', required: true, options: [], next: 'revenue', branches: [] },
    { id: 'revenue', type: 'question', title: 'Qual é o faturamento mensal do seu negócio?', description: '', input: 'select', required: true,
      options: ['Ainda não faturo', 'Até R$ 10 mil', 'R$ 10 mil a R$ 30 mil', 'R$ 30 mil a R$ 100 mil', 'Acima de R$ 100 mil'], next: 'budget', branches: [] },
    { id: 'budget', type: 'question', title: 'Você pode investir pelo menos R$ 50 por dia em anúncios? (valor provisório)', description: 'Este limite é um exemplo e pode ser alterado antes da publicação.', input: 'select', required: true,
      options: ['Sim', 'Não'], next: 'qualified', branches: [{ answer: 'Não', to: 'limited' }] },
    { id: 'qualified', type: 'result', title: 'Vamos conversar sobre o crescimento do seu negócio.', description: 'Deixe seus contatos para continuar com um diagnóstico estratégico.', outcome: 'qualified', actionLabel: 'Agendar diagnóstico', actionHref: '/agendar' },
    { id: 'limited', type: 'result', title: 'Seu negócio também tem espaço para crescer.', description: 'Deixe seus contatos para conhecermos seu momento e encontrar as próximas oportunidades.', outcome: 'limited', actionLabel: 'Conhecer a Cassiellos', actionHref: '/' },
  ] }
}
