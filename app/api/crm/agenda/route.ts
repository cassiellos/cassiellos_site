import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { withCrmReadOnlyTransaction } from '@/lib/crm/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

type AppointmentRow = {
  id: string
  lead_id: string
  full_name: string
  company: string | null
  email: string | null
  whatsapp: string | null
  segment: string | null
  status: string
  starts_at: Date
  ends_at: Date
  meeting_url: string | null
  calendar_event_id: string | null
  confirmed_at: Date | null
  completed_at: Date | null
  cancelled_at: Date | null
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  }
  if (!verifyCrmSession(request.cookies.get(crmSessionCookieName())?.value)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers })
  }
  try {
    const result = await withCrmReadOnlyTransaction(async client => {
      const records = await client.query<AppointmentRow>(
        `SELECT a.id, a.lead_id, l.full_name, l.company, l.email, l.whatsapp,
           l.segment, a.status, a.starts_at, a.ends_at, a.meeting_url,
           a.calendar_event_id, a.confirmed_at, a.completed_at, a.cancelled_at
         FROM crm.appointments a
         JOIN crm.leads l ON l.id = a.lead_id
         ORDER BY a.starts_at DESC, a.id DESC LIMIT 150`,
      )
      const counts = await client.query<{
        total: string; confirmed: string; completed: string; cancelled: string; pending: string
      }>(
        `SELECT count(*)::text AS total,
           count(*) FILTER (WHERE status = 'confirmed')::text AS confirmed,
           count(*) FILTER (WHERE status = 'completed')::text AS completed,
           count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
           count(*) FILTER (WHERE status = 'pending')::text AS pending
         FROM crm.appointments`,
      )
      const count = counts.rows[0]
      return {
        totals: {
          total: Number(count?.total ?? 0),
          confirmed: Number(count?.confirmed ?? 0),
          completed: Number(count?.completed ?? 0),
          cancelled: Number(count?.cancelled ?? 0),
          pending: Number(count?.pending ?? 0),
        },
        appointments: records.rows.map(row => ({
          id: row.id,
          leadId: row.lead_id,
          name: row.full_name,
          company: row.company,
          email: row.email,
          whatsapp: row.whatsapp,
          niche: row.segment,
          status: row.status,
          startsAt: new Date(row.starts_at).toISOString(),
          endsAt: new Date(row.ends_at).toISOString(),
          meetUrl: row.meeting_url,
          hasCalendarEvent: Boolean(row.calendar_event_id),
          confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
          completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
          cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
        })),
      }
    })
    return NextResponse.json({ ok: true, ...result, timeZone: 'America/Sao_Paulo' }, { headers })
  } catch {
    return NextResponse.json({ error: 'AGENDA_UNAVAILABLE' }, { status: 503, headers })
  }
}
