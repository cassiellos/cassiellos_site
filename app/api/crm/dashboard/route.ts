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

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  if (!verifyCrmSession(request.cookies.get(crmSessionCookieName())?.value))
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers })

  const period = request.nextUrl.searchParams.get('period') === '30d' ? 30 : 7
  const showTests = request.nextUrl.searchParams.get('mode') === 'test'
  try {
    const data = await withCrmReadOnlyTransaction(async client => {
      const metrics = await client.query<{
        leads: string; qualified: string; scheduled: string; completed: string; contracts: string
      }>(`SELECT
          (SELECT count(*) FROM crm.leads WHERE is_test = $2 AND created_at >= now() - ($1::int * interval '1 day'))::text AS leads,
          (SELECT count(*) FROM crm.leads WHERE is_test = $2 AND stage = 'qualified' AND created_at >= now() - ($1::int * interval '1 day'))::text AS qualified,
          (SELECT count(*) FROM crm.appointments WHERE is_test = $2 AND status IN ('confirmed','completed') AND confirmed_at >= now() - ($1::int * interval '1 day'))::text AS scheduled,
          (SELECT count(*) FROM crm.appointments WHERE is_test = $2 AND status = 'completed' AND completed_at >= now() - ($1::int * interval '1 day'))::text AS completed,
          (SELECT count(*) FROM crm.deals WHERE is_test = $2 AND status = 'won' AND closed_at >= now() - ($1::int * interval '1 day'))::text AS contracts`, [period, showTests])
      const history = await client.query<{ date: string; leads: string }>(
        `WITH days AS (
           SELECT generate_series(
             (now() AT TIME ZONE 'America/Sao_Paulo')::date - ($1::int - 1),
             (now() AT TIME ZONE 'America/Sao_Paulo')::date,
             interval '1 day'
           )::date AS day
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           count(l.id)::text AS leads
         FROM days d LEFT JOIN crm.leads l
           ON (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.day AND l.is_test = $2
         GROUP BY d.day ORDER BY d.day`, [period, showTests])
      const recent = await client.query<{
        id: string; name: string; company: string | null; stage: string; source: string | null; created_at: Date
      }>(`SELECT l.id, l.full_name AS name, l.company, l.stage,
           f.answers #>> '{attribution,utm_source}' AS source, l.created_at
         FROM crm.leads l
         LEFT JOIN LATERAL (
           SELECT answers FROM crm.form_submissions WHERE lead_id = l.id
           ORDER BY submitted_at DESC, id DESC LIMIT 1
          ) f ON true
         WHERE l.is_test = $1
         ORDER BY l.created_at DESC, l.id DESC LIMIT 5`, [showTests])
      const m = metrics.rows[0]
      return {
        periodDays: period,
        mode: showTests ? 'test' : 'operational',
        metrics: {
          leads: Number(m?.leads ?? 0), qualified: Number(m?.qualified ?? 0),
          scheduled: Number(m?.scheduled ?? 0), completed: Number(m?.completed ?? 0),
          contracts: Number(m?.contracts ?? 0),
        },
        days: history.rows.map(r => ({ date: r.date, count: Number(r.leads) })),
        recent: recent.rows.map(r => ({
          id: r.id, name: r.name, company: r.company, stage: r.stage,
          source: r.source, createdAt: new Date(r.created_at).toISOString(),
        })),
      }
    })
    return NextResponse.json({ ok: true, ...data }, { headers })
  } catch {
    return NextResponse.json({ error: 'DASHBOARD_UNAVAILABLE' }, { status: 503, headers })
  }
}
