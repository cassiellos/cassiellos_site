import { isCrmDatabaseConfigured } from '@/lib/crm/db'
import { checkCrmTables, handleCrmHealthRequest } from '@/lib/crm/health'

// Health check protegido do Mini CRM: confirma a conexão real com o Neon e a
// existência das 10 tabelas do schema crm. Exige Authorization: Bearer <CRM_HEALTHCHECK_TOKEN>.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(request: Request) {
  return handleCrmHealthRequest(request, {
    healthcheckToken: process.env.CRM_HEALTHCHECK_TOKEN,
    databaseConfigured: isCrmDatabaseConfigured(),
    checkTables: checkCrmTables,
  })
}
