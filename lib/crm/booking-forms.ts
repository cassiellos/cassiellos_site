export type BookingField = {
  name: 'clinic' | 'priority' | 'units'
  label: string
  type: 'text' | 'select'
  required: boolean
  placeholder?: string
  options?: readonly string[]
}

export type BookingForm = {
  slug: string
  niche: string
  eyebrow: string
  headline: string
  description: string
  meetingName: string
  durationMinutes: number
  fields: readonly BookingField[]
}

const bookingForms: Record<string, BookingForm> = {
  odontologia: {
    slug: 'odontologia',
    niche: 'Clínicas odontológicas',
    eyebrow: 'DIAGNÓSTICO ESTRATÉGICO / ODONTOLOGIA',
    headline: 'Sua clínica tem espaço para crescer. Vamos conversar?',
    description: 'Conte rapidamente sobre sua clínica e escolha o melhor horário para uma conversa estratégica com a Cassiellos.',
    meetingName: 'Diagnóstico estratégico • Odontologia',
    durationMinutes: 30,
    fields: [
      { name: 'clinic', label: 'Nome da clínica', type: 'text', required: true, placeholder: 'Como sua clínica se chama?' },
      { name: 'priority', label: 'Qual é seu principal objetivo?', type: 'select', required: true,
        options: ['Atrair mais pacientes', 'Melhorar o marketing da clínica', 'Organizar os anúncios e resultados', 'Quero entender as possibilidades'] },
    ],
  },
}

/** Uma configuração por nicho; novas versões podem ser adicionadas sem redesenhar a página. */
export function getBookingForm(slug: string): BookingForm | null {
  return Object.prototype.hasOwnProperty.call(bookingForms, slug) ? bookingForms[slug] : null
}
