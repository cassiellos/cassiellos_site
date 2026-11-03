import { notFound, permanentRedirect } from 'next/navigation'

// Links antigos preservam parâmetros de atribuição e chegam ao único formulário oficial.
export default async function LegacyBookingRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  if (slug !== 'odontologia') notFound()
  const incoming = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item))
    else if (typeof value === 'string') query.append(key, value)
  }
  const suffix = query.toString()
  permanentRedirect('/agendar' + (suffix ? '?' + suffix : ''))
}
