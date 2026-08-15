/** Símbolo do infinito da marca Cassiellos — traçado original preservado. */
export const INFINITY_PATH =
  'M5 16C5 9 10 5 16 5c8 0 11 11 16 11S40 5 48 5c6 0 11 4 11 11s-5 11-11 11c-8 0-11-11-16-11S24 27 16 27C10 27 5 23 5 16Z'

export default function InfinityMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 32" aria-hidden focusable="false">
      <path d={INFINITY_PATH} />
    </svg>
  )
}
