export type BookingField = {
  name: 'clinic' | 'priority' | 'units' | 'revenue'
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
    version: 'odontologia-v2',
    niche: 'Clínicas odontológicas',
    eyebrow: 'DIAGNÓSTICO ESTRATÉGICO / ODONTOLOGIA',
    headline: 'Sua clínica tem espaço para crescer. Vamos conversar?',
    description: 'Conte rapidamente sobre sua clínica e escolha o melhor horário para uma conversa estratégica com a Cassiellos.',
    meetingName: 'Diagnóstico estratégico • Odontologia',
    durationMinutes: 30,
    fields: [
      { name: 'clinic', label: 'Nome da clínica', type: 'text', required: true, placeholder: 'Como sua clínica se chama?' },
      { name: 'revenue', label: 'Qual é o faturamento médio mensal da clínica?', type: 'select', required: true,
        options: REVENUE_RANGES },
      { name: 'priority', label: 'Qual é seu principal objetivo?', type: 'select', required: true,
        options: ['Atrair mais pacientes', 'Melhorar o marketing da clínica', 'Organizar os anúncios e resultados', 'Quero entender as possibilidades'] },
    ],
  },
}

/** Uma configuração por nicho; novas versões podem ser adicionadas sem redesenhar a página. */
export function getBookingForm(slug: string): BookingForm | null {
  return Object.prototype.hasOwnProperty.call(bookingForms, slug) ? bookingForms[slug] : null
}
