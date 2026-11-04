import type { BookingEventInput } from './booking-event'
import type { GoogleCreatedEvent } from './google-calendar'

/**
 * Agenda SIMULADA da homologação isolada (lib/crm/homolog-mode.ts). Não acessa Google, rede ou e-mail:
 * nenhum horário vem ocupado e o "evento" é apenas um identificador local gravado no banco de homologação.
 * Só é escolhida pelas rotas quando o modo de homologação está ATIVO; fora dele as rotas usam o Google real.
 */
export async function simulatedBusyIntervals(): Promise<{ start: string; end: string }[]> {
  return []
}

export async function simulatedCreateEvent(input: BookingEventInput): Promise<GoogleCreatedEvent> {
  return { id: 'homolog' + input.requestId.replaceAll('-', ''), meetingUrl: null, htmlLink: null, invitationRequested: false }
}
