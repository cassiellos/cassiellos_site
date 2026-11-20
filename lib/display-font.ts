import { Unbounded } from 'next/font/google'

/** Fonte larga dos títulos de impacto da home e do rodapé (referência de agência de crescimento). */
export const displayFont = Unbounded({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  display: 'swap',
  variable: '--font-display',
})
