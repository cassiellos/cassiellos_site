/**
 * Contrato servidor → navegador sobre o QUE aconteceu com o cadastro (F3). Módulo puro, usado pela rota e pelo formulário.
 *
 * O servidor é a única autoridade (`saveLeadSubmission`); o navegador nunca deduz "lead novo" de `reused !== true`
 * (isso também aceitava o RECADASTRO de um e-mail que já existe, que não cria lead e inflava `generate_lead`).
 *
 * | leadOutcome   | situação no banco                                                              | generate_lead |
 * | ------------- | ------------------------------------------------------------------------------ | ------------- |
 * | `new`         | linha nova em `crm.leads` (real ou de teste: o modo vem em `leadMode`)         | SIM (uma vez) |
 * | `resubmitted` | e-mail já existente: nova submissão, nenhum lead novo (recadastro em outra visita) | não       |
 * | `reused`      | mesma chave de idempotência: repetição do mesmo envio, nada novo gravado       | não           |
 *
 * Lead de teste é um lead NOVO (`new`) com `leadMode: 'test'`: gera `generate_lead` com `environment_mode=test`, que o
 * roteamento do GTM leva só à propriedade de homologação. Resposta sem `leadOutcome` válido (servidor antigo, corpo
 * adulterado) nunca gera o evento: na dúvida, não conta.
 */
export type LeadOutcome = 'new' | 'resubmitted' | 'reused'

export function leadOutcomeOf(saved: { reused: boolean; resubmitted: boolean }): LeadOutcome {
  if (saved.reused) return 'reused'
  return saved.resubmitted ? 'resubmitted' : 'new'
}

/** Decisão do navegador: só um novo lead efetivamente registrado pelo servidor vira `generate_lead`. */
export function isNewLeadResponse(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const body = data as Record<string, unknown>
  return body.ok === true && body.leadOutcome === 'new'
}
