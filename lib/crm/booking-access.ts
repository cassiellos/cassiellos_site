/**
 * Acesso à confirmação de reuniões do /agendar (Google Calendar/Meet), no Preview.
 *
 * - O FLUXO PÚBLICO é aberto a qualquer e-mail válido: CRM_GOOGLE_BOOKINGS_ENABLED=true no Preview basta.
 * - CRM_BOOKING_ALLOWED_EMAIL continua existindo para a homologação: o e-mail dela é sempre classificado como teste e
 *   pode ser usado em testes controlados. Ele SÓ restringe o agendamento quando, explicitamente,
 *   CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL=true (modo de homologação isolado). Se a restrição for pedida sem um e-mail
 *   válido configurado, a confirmação fica desligada (falha fechada), nunca aberta por engano.
 * - Proteções que valem para todos: Turnstile verificado no servidor, cota por IP, limite por caixa de e-mail,
 *   uma reunião ativa por contato e reserva atômica do horário.
 */
export type BookingAccess = { enabled: boolean; restrictedToAllowedEmail: boolean; allowedEmail: string; sendInvites: boolean }

export function bookingAccessConfig(env: Record<string, string | undefined> = process.env): BookingAccess {
  const allowedEmail = (env.CRM_BOOKING_ALLOWED_EMAIL ?? '').trim()
  const restrictedToAllowedEmail = env.CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL?.trim().toLowerCase() === 'true'
  const switchOn = env.VERCEL_ENV === 'preview' && env.CRM_GOOGLE_BOOKINGS_ENABLED === 'true'
  const enabled = switchOn && (!restrictedToAllowedEmail || allowedEmail.includes('@'))
  // Convite do Google Agenda ao e-mail do lead: LIGADO por padrão; CRM_BOOKING_SEND_INVITES=false desliga sem novo deploy.
  const sendInvites = env.CRM_BOOKING_SEND_INVITES?.trim().toLowerCase() !== 'false'
  return { enabled, restrictedToAllowedEmail, allowedEmail, sendInvites }
}
