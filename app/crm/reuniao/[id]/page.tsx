import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { isGoogleMeetUrl } from '@/lib/crm/booking-event'
import { withCrmReadOnlyTransaction } from '@/lib/crm/db'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { loadPushSettings } from '@/lib/crm/push/store'
import { safeCrmReturnPath } from '@/lib/crm/return-path'
import { DEFAULT_WHATSAPP_TEMPLATE, renderWhatsappMessage } from '@/lib/crm/whatsapp-message'
import { parseBrazilianWhatsapp } from '@/lib/crm/whatsapp'
import MeetingWhatsapp from './meeting-whatsapp'
import '../../crm.css'
import './meeting.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reunião | SHARK SCALE', robots: { index: false, follow: false, nocache: true } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

type Row = { id: string; status: string; starts_at: Date; ends_at: Date; meeting_url: string | null; is_test: boolean; ended: boolean
  lead_id: string; full_name: string | null; company: string | null; whatsapp: string | null; form_slug: string | null }

/** Ficha da reunião (destino dos avisos 1 e 2). Só com sessão administrativa; nada é enviado sozinho. */
export default async function MeetingPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ whatsapp?: string }>
}) {
  const { id } = await params
  const { whatsapp } = await searchParams
  const focusWhatsapp = whatsapp === '1'
  const cookieStore = await cookies()
  if (!verifyCrmSession(cookieStore.get(crmSessionCookieName())?.value)) {
    const self = safeCrmReturnPath('/crm/reuniao/' + id + (focusWhatsapp ? '?whatsapp=1' : ''))
    redirect(self ? '/crm/login?next=' + encodeURIComponent(self) : '/crm/login')
  }
  if (!UUID.test(id)) redirect('/crm')

  let row: Row | null = null
  let template = DEFAULT_WHATSAPP_TEMPLATE
  try {
    row = await withCrmReadOnlyTransaction(async client => (await client.query<Row>(
      `SELECT a.id, a.status, a.starts_at, a.ends_at, a.meeting_url, a.is_test, (a.ends_at <= now()) AS ended,
              l.id AS lead_id, l.full_name, l.company, l.whatsapp, s.answers ->> 'formSlug' AS form_slug
         FROM crm.appointments a JOIN crm.leads l ON l.id = a.lead_id
         LEFT JOIN crm.booking_requests b ON b.appointment_id = a.id
         LEFT JOIN crm.form_submissions s ON s.id = b.submission_id
        WHERE a.id = $1 LIMIT 1`, [id])).rows[0] ?? null)
    const settings = await loadPushSettings(pushRuntimeDeps().pool).catch(() => null)
    if (settings) template = settings.whatsappTemplate
  } catch { row = null }

  if (!row) {
    return <div id="cassiellos-crm"><main className="crm-meeting-shell"><section className="crm-card crm-meeting-card">
      <a className="crm-meeting-back" href="/crm">← Voltar ao CRM</a>
      <h1>Reunião não encontrada</h1><p className="crm-meeting-muted">Ela pode ter sido removida ou o link está incompleto.</p>
    </section></main></div>
  }

  const meetUrl = isGoogleMeetUrl(row.meeting_url) ? row.meeting_url : null
  const meetingName = (row.form_slug && getBookingForm(row.form_slug)?.meetingName) || 'Reunião Cassiellos'
  const phone = parseBrazilianWhatsapp(row.whatsapp)
  const active = (row.status === 'confirmed' || row.status === 'pending') && !row.ended
  const statusLabel = row.status === 'cancelled' ? 'Cancelada' : row.ended ? 'Encerrada' : row.status === 'confirmed' ? 'Confirmada' : row.status
  const start = new Date(row.starts_at)
  const message = renderWhatsappMessage(template, {
    name: row.full_name, company: row.company, startsAt: row.starts_at, endsAt: row.ends_at, meetingUrl: meetUrl, meetingName,
  })

  return <div id="cassiellos-crm">
    <main className="crm-meeting-shell">
      <section className="crm-card crm-meeting-card" aria-labelledby="meeting-title">
        <div className="crm-meeting-top">
          <a className="crm-meeting-back" href="/crm">← CRM</a>
          <img src="/brand/cassiellos-symbol-signal-red.svg" width="40" height="20" alt="" aria-hidden="true" />
        </div>
        <div className="crm-eyebrow">SHARK SCALE · Reunião {row.is_test && <span className="crm-test-tag">TESTE</span>}</div>
        <h1 id="meeting-title">{row.full_name || 'Contato sem nome'}</h1>
        <p className="crm-meeting-muted">{row.company || 'Empresa não informada'}</p>
        <dl className="crm-meeting-grid">
          <div><dt>Data</dt><dd>{fmt.format(start)}</dd></div>
          <div><dt>Horário</dt><dd>{time.format(start)} – {time.format(new Date(row.ends_at))}</dd></div>
          <div><dt>WhatsApp</dt><dd>{phone ? phone.display : 'Inválido ou não informado'}</dd></div>
          <div><dt>Situação</dt><dd data-status={active ? 'ok' : 'off'}>{statusLabel}</dd></div>
          <div className="crm-meeting-wide"><dt>Reunião</dt><dd>{meetingName}</dd></div>
        </dl>
        <div className="crm-meeting-actions">
          {meetUrl ? <a className="crm-btn" href={meetUrl} target="_blank" rel="noopener noreferrer">Abrir Google Meet</a>
            : <span className="crm-meeting-muted">Link do Meet pendente — confira no Google Agenda.</span>}
          <a className="crm-btn" href={'/crm?lead=' + row.lead_id}>Abrir ficha do lead</a>
        </div>
      </section>
      <MeetingWhatsapp initialText={message} whatsapp={row.whatsapp} active={active} focus={focusWhatsapp} meetPending={!meetUrl} />
    </main>
  </div>
}
