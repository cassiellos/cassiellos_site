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

const bookingForms: Record<string, BookingForm> = {
  odontologia: {
    slug: 'odontologia',
    version: 'odontologia-v3',
    niche: 'Clínicas odontológicas',
    eyebrow: 'DIAGNÓSTICO ESTRATÉGICO / ODONTOLOGIA',
    headline: 'Tráfego pago para clínicas odontológicas que querem vender mais.'
    description: 'Um diagnóstico direto para entender o momento da sua clínica e avaliar oportunidades de crescimento.'
    meetingName: 'Diagnóstico estratégico • Odontologia',
    durationMinutes: 30,
    fields: [
      { name: 'instagram', label: 'Qual é o site ou @ do Instagram da sua clínica?', type: 'text', required: true, placeholder: '@suaclinica' },
      { name: 'revenue', label: 'Qual é o faturamento mensal da sua clínica?', type: 'select', required: true, options: REVENUE_RANGES },
      { name: 'budget', label: 'Para escalar com segurança, recomendamos um investimento a partir de (valor). Isso cabe no seu planejamento?', type: 'select', required: true, options: ['Sim', 'Não'] },
    ],  },
}

/** Uma configuração por nicho; novas versões podem ser adicionadas sem redesenhar a página. */
export function getBookingForm(slug: string): BookingForm | null {
  return Object.prototype.hasOwnProperty.call(bookingForms, slug) ? bookingForms[slug] : null
}
