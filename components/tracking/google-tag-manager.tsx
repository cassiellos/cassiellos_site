'use client'

import { useEffect } from 'react'
import { startGoogleTagManager } from '@/lib/tracking/gtm-runtime'

/**
 * Google Tag Manager do formulário (container dedicado). Montado só nas páginas do formulário e do calendário.
 * Toda a lógica (Consent Mode v2, carregamento só após o aceite, limpeza na revogação e ponte dos eventos antigos)
 * está em lib/tracking/gtm-runtime.ts, onde é testada. Sem `containerId` nada é carregado.
 */
export default function GoogleTagManager({ containerId }: { containerId: string | null }) {
  useEffect(() => startGoogleTagManager(containerId), [containerId])
  return null
}
