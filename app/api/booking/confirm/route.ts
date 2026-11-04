import { NextRequest, NextResponse, after } from 'next/server'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { confirmBookingRequest } from '@/lib/crm/booking-confirmation'
import { parseLimitExemptMailboxes } from '@/lib/crm/booking-reservation'
import { getCrmPool } from '@/lib/crm/db'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'
import { createGoogleBooking, readGoogleBusyIntervals } from '@/lib/crm/google-calendar'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { isHomologActive } from '@/lib/crm/homolog-mode'
import { simulatedBusyIntervals, simulatedCreateEvent } from '@/lib/crm/homolog-calendar'
import { activeHomologation } from '@/lib/marketing/homologation'
import { claimHomologationEvent } from '@/lib/crm/meta-homologation-claims'
import { readPushEnv } from '@/lib/crm/push/config'
import { confirmedMeetingFrom, queueThenDeliver } from '@/lib/crm/push/hooks'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { deliverAfterEvent, enqueueMeetingNotifications } from '@/lib/crm/push/store'
import { bookingAccessConfig } from '@/lib/crm/booking-access'
import { clientIpFrom, clientUserAgentFrom, dispatchScheduleToMeta, pgCapiStore, readCapiConfig } from '@/lib/crm/meta-capi'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

/** Homologação do Meta Pixel ativa (liberação deste navegador): reserva o único Schedule da liberação no banco. */
function homologationClaims(cookieHeader: string | null) {
  const active = activeHomologation(cookieHeader)
  // Liberação "chronos": só eventos personalizados da jornada; nenhum Lead/Schedule de teste é reservado.
  if (!active || active.scope !== 'conversions') return null
  return {
    claim: (input: { event: 'Schedule'; leadId: string; eventId: string }) =>
      claimHomologationEvent(getCrmPool(), { ...input, nonce: active.nonce, actorRef: active.actorRef }),
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function json(data: unknown, status: number) {
  return NextResponse.json(data, {
    status, headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}


/**
 * PREVIEW ONLY. Deliberately OFF unless the owner opts in and adds two
 * branch-scoped environment variables after a controlled real-email test plan.
 * An external Google event is never retried automatically after uncertain failure.
 * The booking session can only be obtained after the server-side Turnstile check
 * in /api/booking/leads; the submission must also be marked as verified.
 */
export async function POST(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const access = bookingAccessConfig()
  if (!access.enabled) return json({ error: 'BOOKING_DISABLED' }, 423)
  const origin = request.headers.get('origin')
  if (!isCrmPreviewOrigin(origin)) return json({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'INVALID_REQUEST' }, 400)

  let data: { bookingToken?: unknown; startAt?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 2_000) return json({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return json({ error: 'INVALID_REQUEST' }, 400)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }

  const result = await confirmBookingRequest({
    pool: getCrmPool(),
    verifySession: verifyBookingGrant,
    getForm: getBookingForm,
    // Homologação isolada: agenda simulada, sem Google nem convite (lib/crm/homolog-mode.ts).
    readBusy: isHomologActive() ? simulatedBusyIntervals : readGoogleBusyIntervals,
    createEvent: isHomologActive() ? simulatedCreateEvent : createGoogleBooking,
    calendarId: process.env.CRM_GOOGLE_CALENDAR_ID?.trim() || 'primary',
    // Público: qualquer e-mail válido. Só restringe ao e-mail de homologação se CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL=true.
    allowedEmail: access.allowedEmail, restrictToAllowedEmail: access.restrictedToAllowedEmail,
    sendInvites: access.sendInvites,
    metaHomologation: homologationClaims(request.headers.get('cookie')),
    limits: { exemptMailboxes: parseLimitExemptMailboxes() },
    loadRules: () => loadAvailabilityRules(getCrmPool()),
  }, { bookingToken: data.bookingToken, startAt: data.startAt, pageOrigin: origin })
  // Etapa 5 (Web Push): só reunião NOVA (201). Desligado por padrão (PWA_PUSH_ENABLED); nunca afeta a confirmação.
  await queueThenDeliver(confirmedMeetingFrom(result), {
    switchReady: () => readPushEnv().ready,
    enqueue: meeting => enqueueMeetingNotifications(pushRuntimeDeps(), meeting).then(r => r.ids),
    schedule: task => after(task),
    deliver: ids => deliverAfterEvent(pushRuntimeDeps(), ids),
  })
  // Meta Conversions API (Schedule): DESLIGADA salvo META_CAPI_MODE=test|live + token. Roda só depois da resposta,
  // nunca bloqueia nem desfaz a reunião; user agent/IP ficam só em memória (lib/crm/meta-capi.ts).
  const scheduleEventId = scheduleEventIdFrom(result)
  const capi = scheduleEventId ? readCapiConfig() : null
  if (scheduleEventId && capi && capi.mode !== 'off') {
    const clientIp = clientIpFrom(request.headers)
    const userAgent = clientUserAgentFrom(request.headers)
    after(() => dispatchScheduleToMeta({
      config: capi, store: pgCapiStore(getCrmPool()), fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
      log: entry => console.info(JSON.stringify(entry)),
    }, { eventId: scheduleEventId, clientIp, userAgent }).then(() => undefined))
  }
  return json(result.body, result.status)
}

/** event_id do Schedule só quando a confirmação criou uma reunião nova (201) para lead real ou homologação. */
function scheduleEventIdFrom(result: { status: number; body: unknown }): string | null {
  if (result.status !== 201 || !result.body || typeof result.body !== 'object') return null
  const tracking = (result.body as { tracking?: { schedule?: { eventId?: unknown } } }).tracking
  const id = tracking?.schedule?.eventId
  return typeof id === 'string' && /^chronos_scheduled_[a-f0-9]{32}$/.test(id) ? id : null
}
