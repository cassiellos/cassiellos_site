/**
 * Configuração do container do Google Tag Manager dedicado ao formulário (lida no servidor).
 * DESLIGADO por padrão: sem `TRACKING_GTM_ENABLED=true` e um `GTM_FORM_CONTAINER_ID` válido nada é renderizado nem
 * carregado. Ligar exige autorização expressa e a variável no ambiente de produção.
 */
import { isTrackingScopeForm } from './funnel-contract'

export const GTM_ID_PATTERN = /^GTM-[A-Z0-9]{4,12}$/

export type GtmConfig = { enabled: true; containerId: string } | { enabled: false }

export function getGtmFormConfig(env: Record<string, string | undefined> = process.env): GtmConfig {
  const containerId = (env.GTM_FORM_CONTAINER_ID?.trim() || '').toUpperCase()
  if (env.TRACKING_GTM_ENABLED?.trim() !== 'true' || !GTM_ID_PATTERN.test(containerId)) return { enabled: false }
  return { enabled: true, containerId }
}

/**
 * Configuração do GTM para UM formulário publicado (F2). Além das duas variáveis, exige que o slug canônico seja
 * exatamente o do escopo desta implantação; para qualquer outro formulário o GTM não é renderizado nem carregado,
 * mesmo com o contêiner configurado e mesmo que um gatilho do GTM estivesse frouxo.
 */
export function getGtmFormConfigForSlug(slug: string, env: Record<string, string | undefined> = process.env): GtmConfig {
  return isTrackingScopeForm(slug) ? getGtmFormConfig(env) : { enabled: false }
}
