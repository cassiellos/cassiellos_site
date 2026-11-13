/**
 * Guarda de SOMENTE LEITURA para os adaptadores reais (fase futura).
 *
 * O escopo OAuth `https://www.googleapis.com/auth/adwords` dá acesso de escrita; o token de sistema da Meta pode ter
 * permissões além de `ads_read`. A proteção não pode depender do escopo: todo pedido montado por um adaptador real
 * passa por aqui ANTES de sair do servidor, e só operações explicitamente listadas como leitura são permitidas.
 * Qualquer outra coisa lança erro — inclusive métodos HTTP de escrita e GAQL que não seja SELECT.
 */
import type { IntelPlatform } from './contracts'

export type OutboundRequest =
  | { platform: 'google_ads'; service: string; method: string; query?: string }
  | { platform: 'meta_ads'; httpMethod: string; path: string }
  | { platform: 'ga4'; api: 'data' | 'admin'; method: string }
  | { platform: 'gtm'; httpMethod: string; resource: string }

export class ReadOnlyViolation extends Error {
  constructor(platform: IntelPlatform, detail: string) { super('operação não permitida (' + platform + '): ' + detail); this.name = 'ReadOnlyViolation' }
}

const GOOGLE_ADS_READ = new Set(['CustomerService.ListAccessibleCustomers', 'GoogleAdsService.Search', 'GoogleAdsService.SearchStream'])
const GA4_READ: Record<'data' | 'admin', ReadonlySet<string>> = {
  data: new Set(['runReport', 'batchRunReports', 'getMetadata']),
  admin: new Set(['accountSummaries.list', 'properties.get']),
}
/** Caminhos Graph permitidos (somente GET). `act_<dígitos>` e IDs numéricos. Versão é removida antes da checagem. */
const META_READ_PATHS: readonly RegExp[] = [
  /^\/me\/adaccounts$/,
  /^\/act_\d{5,20}$/,
  /^\/act_\d{5,20}\/(campaigns|insights)$/,
  /^\/\d{5,25}\/insights$/,          // leitura de relatório assíncrono já criado (report_run_id)
  /^\/\d{5,25}$/,                    // status de relatório assíncrono
]
const GTM_READ_RESOURCES: readonly RegExp[] = [
  /^accounts$/, /^accounts\/\d+\/containers$/, /^accounts\/\d+\/containers\/\d+\/versions:live$/,
]

/** GAQL só de consulta: começa com SELECT, sem ponto e vírgula, sem palavras de mutação. */
export function isReadOnlyGaql(query: string): boolean {
  const q = query.trim()
  if (!/^select\s/i.test(q) || q.includes(';')) return false
  return !/\b(insert|update|delete|mutate|create|remove)\b/i.test(q.replace(/'[^']*'/g, "''"))
}

export function assertReadOnlyRequest(req: OutboundRequest): void {
  switch (req.platform) {
    case 'google_ads': {
      const op = req.service + '.' + req.method
      if (!GOOGLE_ADS_READ.has(op)) throw new ReadOnlyViolation('google_ads', op)
      if (op.startsWith('GoogleAdsService.') && !isReadOnlyGaql(req.query ?? '')) throw new ReadOnlyViolation('google_ads', 'GAQL não é consulta')
      return
    }
    case 'meta_ads': {
      if (req.httpMethod.toUpperCase() !== 'GET') {
        // Única exceção prevista: criar relatório assíncrono de insights (POST /act_<id>/insights) — é leitura,
        // mas usa POST na Graph API. Qualquer outro POST/DELETE é recusado.
        if (!(req.httpMethod.toUpperCase() === 'POST' && /^\/act_\d{5,20}\/insights$/.test(stripVersion(req.path))))
          throw new ReadOnlyViolation('meta_ads', req.httpMethod + ' ' + req.path)
        return
      }
      const path = stripVersion(req.path)
      if (!META_READ_PATHS.some(re => re.test(path))) throw new ReadOnlyViolation('meta_ads', 'GET ' + path)
      return
    }
    case 'ga4':
      if (!GA4_READ[req.api]?.has(req.method)) throw new ReadOnlyViolation('ga4', req.api + '.' + req.method)
      return
    case 'gtm':
      if (req.httpMethod.toUpperCase() !== 'GET' || !GTM_READ_RESOURCES.some(re => re.test(req.resource)))
        throw new ReadOnlyViolation('gtm', req.httpMethod + ' ' + req.resource)
      return
  }
}

function stripVersion(path: string): string {
  return path.split('?')[0].replace(/^\/v\d+\.\d+(?=\/)/, '')
}
