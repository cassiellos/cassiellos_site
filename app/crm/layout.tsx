import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mini CRM | Cassiellos',
  description: 'Painel de relacionamento e conversões da Cassiellos.',
  robots: { index: false, follow: false, nocache: true },
}

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  // A interface CRM só pode existir no ambiente de preview durante o desenvolvimento.
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    notFound()
  }
  return children
}
