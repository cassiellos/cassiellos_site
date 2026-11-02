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
    version: 'odontologia-v3',
    niche: 'Clínicas odontológicas',
    eyebrow: 'DIAGNÓSTICO ESTRATÉGICO / ODONTOLOGIA',
    headline: 'Tráfego pago para [seu nicho] que querem vender mais.',
    description: 'Uma conversa direta para entender o seu negócio e encontrar oportunidades de crescimento.',
    meetingName: 'Diagnóstico estratégico • Odontologia',
    durationMinutes: 30,
    fields: [
      { name: 'instagram', label: 'Qual é o seu site ou o Instagram do seu negócio?', type: 'text', required: true, placeholder: 'Seu site ou usuário do Instagram' },
      { name: 'revenue', label: 'Qual é o faturamento mensal do seu negócio?', type: 'select', required: true, options: REVENUE_RANGES },
      { name: 'budget', label: 'Para escalar com segurança, recomendamos investir a partir de [valor]. Isso cabe no seu orçamento?', type: 'select', required: true, options: ['Sim', 'Não'] },
    ],
  },
}

/** Uma configuração por nicho; novas versões podem ser adicionadas sem redesenhar a página. */
export function getBookingForm(slug: string): BookingForm | null {
  return Object.prototype.hasOwnProperty.call(bookingForms, slug) ? bookingForms[slug] : null
}
