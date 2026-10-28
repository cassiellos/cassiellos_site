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

type RealLeadRow = {
  id: string
  full_name: string
  email: string | null
  whatsapp: string | null
  company: string | null
  segment: string | null
  stage: string
  created_at: Date
  form_version: string | null
  revenue: string | null
  objective: string | null
  utm_source: string | null
  utm_campaign: string | null
  utm_medium: string | null
  latest_submission_at: Date | null
  meeting_count: string
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  }
  if (!verifyCrmSession(request.cookies.get(crmSessionCookieName())?.value)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers })
  }
  try {
    const data = await withCrmReadOnlyTransaction(async client => {
      const [records, total] = await Promise.all([
        client.query<RealLeadRow>(
          `SELECT l.id, l.full_name, l.email, l.whatsapp, l.company,
             l.segment, l.stage, l.created_at,
             s.form_version, s.latest_submission_at,
             s.answers #>> '{questions,revenue}' AS revenue,
             s.answers #>> '{questions,priority}' AS objective,
             s.answers #>> '{attribution,utm_source}' AS utm_source,
             s.answers #>> '{attribution,utm_campaign}' AS utm_campaign,
             s.answers #>> '{attribution,utm_medium}' AS utm_medium,
             (SELECT count(*)::text FROM crm.appointments a WHERE a.lead_id = l.id
               AND a.status NOT IN ('cancelled')) AS meeting_count
           FROM crm.leads l
           LEFT JOIN LATERAL (
             SELECT f.form_version, f.answers, f.submitted_at AS latest_submission_at
             FROM crm.form_submissions f
             WHERE f.lead_id = l.id
             ORDER BY f.submitted_at DESC, f.id DESC LIMIT 1
           ) s ON true
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT 100`,
        ),
        client.query<{ count: string }>('SELECT count(*)::text AS count FROM crm.leads'),
      ])
      return {
        total: Number(total.rows[0]?.count ?? 0),
        leads: records.rows.map(row => ({
          id: row.id,
          name: row.full_name,
          email: row.email,
          whatsapp: row.whatsapp,
          company: row.company,
          niche: row.segment,
          status: row.stage,
          revenue: row.revenue,
          objective: row.objective,
          formVersion: row.form_version,
          source: row.utm_source,
          campaign: row.utm_campaign,
          medium: row.utm_medium,
          createdAt: new Date(row.created_at).toISOString(),
          submittedAt: row.latest_submission_at
            ? new Date(row.latest_submission_at).toISOString() : null,
          hasMeeting: Number(row.meeting_count) > 0,
        })),
      }
    })
    return NextResponse.json({ ok: true, ...data }, { headers })
  } catch {
    // Never expose contact information, connection strings, or SQL in logs.
    return NextResponse.json({ error: 'LEADS_UNAVAILABLE' }, { status: 503, headers })
  }
}
