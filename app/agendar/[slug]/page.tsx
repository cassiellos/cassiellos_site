import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { getTurnstileConfig } from '@/lib/crm/turnstile'
import { getCrmBookingMode } from '@/lib/crm/booking-mode'
import { funnelModeFor } from '@/lib/crm/funnel-events'
import { getMetaPixelConfig } from '@/lib/marketing/meta'
import { activeHomologation } from '@/lib/marketing/homologation'
import BookingExperience from './booking-experience'
import './booking.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Diagnóstico estratégico | Cassiellos',
  description: 'Página de agendamento de diagnóstico Cassiellos — ambiente de testes.',
  robots: { index: false, follow: false, nocache: true },
}

export default async function NicheBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  // Form pages stay completely off the production domain until approval.
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    notFound()
  }
  const { slug } = await params
  const form = getBookingForm(slug)
  if (!form) notFound()
  const bookingEnabled = process.env.VERCEL_ENV === 'preview' &&
    process.env.CRM_GOOGLE_BOOKINGS_ENABLED === 'true' &&
    Boolean(process.env.CRM_BOOKING_ALLOWED_EMAIL?.trim())
  // Only the PUBLIC site key reaches the browser, and only when the server-side
  // configuration is complete (otherwise the form stays blocked: fail closed).
  const turnstile = getTurnstileConfig()
  const turnstileSiteKey = turnstile.status === 'ready' ? turnstile.siteKey : null
  // Métricas do funil: "test" no ambiente de testes (modo de teste ou allowlist ativa); só "live" conta como real.
  const analyticsMode = funnelModeFor({
    bookingMode: getCrmBookingMode(),
    allowlistActive: Boolean(process.env.CRM_BOOKING_ALLOWED_EMAIL?.trim()),
  })
  // Meta Pixel: desligado salvo META_PIXEL_ENABLED=true + META_PIXEL_ID válido (o ID do Pixel é público).
  const pixel = getMetaPixelConfig()
  // Homologação (só Preview, liberada pelo administrador NESTE navegador): mesmo Pixel COMERCIAL; o backend libera
  // no máximo 1 Lead e 1 Schedule de teste, marcados (lib/marketing/homologation.ts).
  const homologation = activeHomologation((await cookies()).toString())
  const metaPixelId = homologation ? homologation.pixelId : pixel.enabled ? pixel.pixelId : null
  return <BookingExperience form={form} bookingEnabled={bookingEnabled} turnstileSiteKey={turnstileSiteKey}
    analyticsMode={analyticsMode} metaPixelId={metaPixelId}
    metaHomologation={homologation ? { expiresAt: homologation.expiresAt } : null} />
}
