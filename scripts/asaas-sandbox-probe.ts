/**
 * CRM | Cassiellos — CONSULTA SOMENTE LEITURA ao Asaas SANDBOX (Fase 2.2B). Executada PELO TITULAR, no próprio
 * computador, FORA de qualquer sessão de agente (Claude Code, etc.).
 *
 *   node --import tsx scripts/asaas-sandbox-probe.ts --confirmo-somente-leitura
 *
 * - A chave é lida do Keychain (macOS) ou do Secret Service (Linux) neste processo, em tempo de execução.
 *   Nunca de variável de ambiente, argumento, arquivo ou banco. Ver docs/crm/asaas-sandbox-credencial.md.
 * - Faz exatamente 4 GETs de listagem (clientes, cobranças, assinaturas) em https://api-sandbox.asaas.com/v3.
 * - Imprime SÓ um relatório sanitizado (status, tempos, contagens, nomes de campos) — pode ser colado na conversa.
 *   Nunca imprime a chave, cabeçalhos ou registros.
 */
import { loadSandboxKey } from '../lib/crm/asaas/credential'
import { runSandboxReadProbe } from '../lib/crm/asaas/probe'
import { createSandboxHttpsTransport } from '../lib/crm/asaas/transport-https'

async function main() {
  if (Object.keys(process.env).some(k => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_'))) {
    console.error('Recusado: execute no seu terminal, fora de sessões de agente (a chave não pode ficar acessível ao agente).')
    process.exit(2)
  }
  if (!process.argv.includes('--confirmo-somente-leitura')) {
    console.error('Uso: node --import tsx scripts/asaas-sandbox-probe.ts --confirmo-somente-leitura')
    process.exit(2)
  }
  let apiKey: string
  try { apiKey = await loadSandboxKey() } catch (e) {
    console.error('Credencial indisponível: ' + ((e as { code?: string }).code ?? 'ERRO'))
    process.exit(3)
  }
  const report = await runSandboxReadProbe({ apiKey, transport: createSandboxHttpsTransport() })
  apiKey = ''
  console.log(JSON.stringify({ geradoEm: new Date().toISOString(), ...report }, null, 2))
}

main().catch(e => { console.error('Falha: ' + ((e as { code?: string }).code ?? 'UNEXPECTED_ERROR')); process.exit(1) })
