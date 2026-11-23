import { googleCalendarTemplateUrl } from '../calendar-links'
import type { BrazilianPhone } from '../whatsapp'

/**
 * Modelos dos e-mails transacionais. Funções puras: o mesmo conteúdo em teste e em produção.
 *
 * Regras de e-mail (não são preferências de estilo — são o que os clientes de e-mail aceitam):
 * - tabelas e estilo embutido; nada de CSS externo, flexbox ou grid (Outlook ignora);
 * - largura máxima de 600 px com fallback de 100% no celular;
 * - sempre uma versão em texto puro (anti-spam e leitores sem HTML);
 * - nenhuma imagem remota: o cabeçalho é tipográfico, então não há "carregar imagens" nem pixel de rastreio.
 * Todo texto variável passa por escapeHtml: nome e empresa vêm do formulário público.
 */

const BRAND_NAVY = '#07101f'
const BRAND_RED = '#f13c4b'
const PAPER = '#f6f8ff'
const INK = '#16202f'
const MUTED = '#5d6b7f'
const TZ = 'America/Sao_Paulo'

const dateLong = new Intl.DateTimeFormat('pt-BR',
  { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
const timeShort = new Intl.DateTimeFormat('pt-BR',
  { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i

export type EmailKind = 'confirmation' | 'reminder_morning' | 'reminder_1h'

export type MeetingEmailInput = {
  name: string | null
  startAt: string
  endAt: string
  meetUrl: string | null
  meetingTitle: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

function firstName(name: string | null): string {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ')
  return clean ? clean.split(' ')[0].slice(0, 40) : 'tudo bem'
}

const COPY: Record<EmailKind, { subject: string; eyebrow: string; lead: (n: string) => string; closing: string }> = {
  confirmation: {
    subject: 'Sua reunião com a Cassiellos está confirmada!',
    eyebrow: 'REUNIÃO CONFIRMADA',
    lead: n => 'Olá, ' + n + '! Sua reunião de diagnóstico estratégico com a equipe Cassiellos está confirmada.',
    closing: 'Durante nosso encontro, vamos entender o momento do seu negócio e identificar oportunidades de crescimento.',
  },
  reminder_morning: {
    subject: 'Hoje: sua reunião com a Cassiellos',
    eyebrow: 'É HOJE',
    lead: n => 'Olá, ' + n + '! Passando para lembrar: sua reunião de diagnóstico estratégico com a Cassiellos é hoje.',
    closing: 'Se precisar remarcar, entre em contato com a equipe Cassiellos.',
  },
  reminder_1h: {
    subject: 'Em 1 hora: sua reunião com a Cassiellos',
    eyebrow: 'COMEÇA EM 1 HORA',
    lead: n => 'Olá, ' + n + '! Sua reunião de diagnóstico estratégico com a Cassiellos começa em 1 hora.',
    closing: 'Deixe o link do Meet à mão para entrar no horário.',
  },
}

function button(href: string, label: string, background: string, color: string): string {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px">' +
    '<tr><td style="border-radius:10px;background:' + background + '">' +
    '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" ' +
    'style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;' +
    'font-weight:700;color:' + color + ';text-decoration:none;border-radius:10px">' + escapeHtml(label) + '</a>' +
    '</td></tr></table>'
}

function row(label: string, value: string): string {
  return '<tr>' +
    '<td style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:' + MUTED + '">' +
      escapeHtml(label) + '</td>' +
    '<td style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:' + INK + ';font-weight:700">' +
      escapeHtml(value) + '</td>' +
  '</tr>'
}

export function renderMeetingEmail(kind: EmailKind, input: MeetingEmailInput): RenderedEmail {
  const copy = COPY[kind]
  const start = new Date(input.startAt)
  const dateText = dateLong.format(start)
  const timeText = timeShort.format(start)
  const meet = input.meetUrl && MEET_URL.test(input.meetUrl) ? input.meetUrl : null
  const greeting = copy.lead(firstName(input.name))
  const calendarUrl = googleCalendarTemplateUrl({
    title: input.meetingTitle, startAt: input.startAt, endAt: input.endAt, meetUrl: meet,
  })

  const html = '<!doctype html><html lang="pt-BR"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + escapeHtml(copy.subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + PAPER + '">' +
    // Pré-cabeçalho: o trecho que a caixa de entrada mostra ao lado do assunto.
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' +
      escapeHtml(dateText + ' às ' + timeText + ' (horário de Brasília)') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background:' + PAPER + ';padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
      'style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;' +
      'border:1px solid #e3e9f2">' +

    '<tr><td style="background:' + BRAND_NAVY + ';padding:26px 32px">' +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#ffffff;' +
        'letter-spacing:.01em">Agência Cassiellos</div>' +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;color:' + BRAND_RED + ';' +
        'letter-spacing:.16em;margin-top:7px">' + escapeHtml(copy.eyebrow) + '</div>' +
    '</td></tr>' +

    '<tr><td style="padding:30px 32px 8px">' +
      '<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:' + INK + '">' +
        escapeHtml(greeting) + '</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="border-top:1px solid #e3e9f2;border-bottom:1px solid #e3e9f2;margin:0 0 22px">' +
        row('Data', dateText) +
        row('Horário', timeText + ' (horário de Brasília)') +
        row('Formato', 'Google Meet') +
      '</table>' +
      (meet
        ? button(meet, 'Entrar no Google Meet', BRAND_RED, '#ffffff')
        : '<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:' + MUTED + '">' +
          'O horário está reservado. O link do Google Meet chega em seguida.</p>') +
      button(calendarUrl, 'Adicionar à minha agenda', '#eef2f9', INK) +
      '<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:' + INK + '">' +
        escapeHtml(copy.closing) + '</p>' +
      '<p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:' + INK + '">' +
        'Até breve!<br><strong>Equipe Cassiellos</strong></p>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 32px 28px">' +
      '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:' + MUTED + '">' +
        'Você recebeu este e-mail porque agendou uma reunião com a Agência Cassiellos. ' +
        'Para remarcar ou cancelar, entre em contato com a equipe Cassiellos.</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>'

  const text = [
    greeting, '',
    'Data: ' + dateText,
    'Horário: ' + timeText + ' (horário de Brasília)',
    'Google Meet: ' + (meet ?? 'o link chega em seguida'),
    '', 'Adicionar à agenda: ' + calendarUrl,
    '', copy.closing,
    '', 'Até breve!', 'Equipe Cassiellos',
    '', 'Para remarcar ou cancelar, entre em contato com a equipe Cassiellos.',
  ].join('\n')

  return { subject: copy.subject, html, text }
}

/**
 * Resposta automática do Modo B (WhatsApp). Texto puro: a Cloud API não aceita HTML.
 * humanContact: atendimento humano (número comercial). O número da API não tem aplicativo, então a
 * resposta indica onde falar com a equipe; null mantém o texto original.
 */
export function renderWhatsappAutoReply(input: MeetingEmailInput, humanContact: BrazilianPhone | null = null): string {
  const start = new Date(input.startAt)
  const meet = input.meetUrl && MEET_URL.test(input.meetUrl) ? input.meetUrl : null
  const human = humanContact
    ? ['', 'Este número envia apenas confirmações automáticas.',
      'Para falar com a nossa equipe: https://wa.me/' + humanContact.e164Digits]
    : []
  return [
    'Olá, ' + firstName(input.name) + '! 👋', '',
    'Seu diagnóstico estratégico com a Cassiellos está confirmado! ✅', '',
    '📅 Data: ' + dateLong.format(start),
    '🕒 Horário: ' + timeShort.format(start) + ' (horário de Brasília)',
    '💻 Google Meet: ' + (meet ?? 'o link chega em seguida'), '',
    'Nossa equipe estará preparada para conhecer melhor seu negócio e identificar oportunidades de crescimento.',
    ...human, '',
    'Até breve!', 'Equipe Cassiellos',
  ].join('\n')
}
