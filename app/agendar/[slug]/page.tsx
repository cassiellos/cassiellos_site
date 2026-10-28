import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBookingForm } from '@/lib/crm/booking-forms'
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
  return <BookingExperience form={form} bookingEnabled={bookingEnabled} />
}
