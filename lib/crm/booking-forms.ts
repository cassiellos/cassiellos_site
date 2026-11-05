export type BookingField = {
  name: 'clinic' | 'priority' | 'units' | 'revenue' | 'instagram' | 'budget'
  label: string
  type: 'text' | 'select'
  required: boolean
  placeholder?: string
  options?: readonly string[]
}

export type BookingForm = {
  slug: string
  version: string
  niche: string
  eyebrow: string
  headline: string
  /** Destaques da tela inicial: somente fatos do serviço (sem depoimentos, resultados ou valores não comprovados). */
  highlights: readonly string[]
  /** Texto do botão que inicia o formulário. */
  cta: string
  description: string
  meetingName: string
  durationMinutes: number
  fields: readonly BookingField[]
}

/**
 * Faixas de faturamento mensal (odontologia-v2). O valor salvo em
 * form_submissions.answers.questions.revenue é o próprio rótulo da faixa;
 * envios antigos (odontologia-v1) mantêm o texto livre original.
 */
export const REVENUE_RANGES = [
  'Ainda não faturo',
  'Até R$ 10 mil/mês',
  'De R$ 10 mil a R$ 30 mil/mês',
  'De R$ 30 mil a R$ 50 mil/mês',
  'De R$ 50 mil a R$ 100 mil/mês',
  'De R$ 100 mil a R$ 300 mil/mês',
  'Acima de R$ 300 mil/mês',
] as const

/**
 * Accept an Instagram username (with or without @), an Instagram profile URL,
 * or a normal public website URL with or without https://.
 * Pure validation shared by browser and server; no network lookups.
 */
export function isValidWebPresence(input: unknown): boolean {
  if (typeof input !== 'string') return false
  const value = input.trim()
  if (value.length < 2 || value.length > 120 || /[\s\u0000-\u001f\u007f]/.test(value)) return false
  if (/^@?[a-zA-Z0-9._]{2,30}$/.test(value)) return true
  if (!/^(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9]/i.test(value)) return false
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (url.username || url.password || url.port) return false
    const hostname = url.hostname.toLowerCase()
    // No localhost, private hosts, IP literals or tricky domain label shapes.
    if (/^(?:localhost|.*\.localhost)$/.test(hostname)) return false
    if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return false
    if (hostname === 'instagram.com' || hostname === 'www.instagram.com') {
      return /^\/[a-zA-Z0-9._]{2,30}\/?$/.test(url.pathname)
    }
    return true
  } catch {
    return false
  }
}

const bookingForms: Record<string, BookingForm> = {
  odontologia: {
    slug: 'odontologia',
    // v5: formulário comercial único, público e independente de nicho.
    // O identificador "odontologia" é legado e preservado por compatibilidade com agendamentos e métricas.
    // Os nomes técnicos dos campos permanecem estáveis para não quebrar o CRM.
    version: 'geral-v1',
    niche: 'Geral',
    eyebrow: 'DIAGNÓSTICO ESTRATÉGICO',
    headline: 'Agende seu diagnóstico estratégico com a Cassiellos',
    highlights: [
      'Análise do seu negócio, da sua presença digital e dos seus anúncios atuais',
      'Prioridades definidas para a realidade do seu negócio',
      'Conversa de 30 minutos pelo Google Meet, no horário que você escolher',
    ],
    cta: 'Quero agendar meu diagnóstico',
    description: 'Escolha o melhor horário para conversar com nossa equipe sobre os desafios e as oportunidades do seu negócio.',
    meetingName: 'Diagnóstico estratégico',
    durationMinutes: 30,
    fields: [
      { name: 'instagram', label: 'Qual é o seu site ou o Instagram do seu negócio?', type: 'text', required: true, placeholder: 'Seu site ou usuário do Instagram' },
      { name: 'revenue', label: 'Qual é o faturamento mensal do seu negócio?', type: 'select', required: true, options: REVENUE_RANGES },
      { name: 'budget', label: 'Você tem verba disponível para investir em anúncios todos os meses?', type: 'select', required: true, options: ['Sim', 'Não'] },
    ],
  },
}

/** Configuração comercial única; a chave legada preserva a compatibilidade com dados existentes. */
export function getBookingForm(slug: string): BookingForm | null {
  return Object.prototype.hasOwnProperty.call(bookingForms, slug) ? bookingForms[slug] : null
}
