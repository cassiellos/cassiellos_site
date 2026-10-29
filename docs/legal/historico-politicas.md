# Textos jurídicos — histórico de versões e checklist de publicação

Fonte única da versão: `LEGAL_POLICY_VERSION` em `lib/legal/policy.ts`. Ela é exibida como
"Última atualização" na Política de Privacidade e na Política de Cookies e gravada em
`crm.consents.policy_version` (`diagnostic_contact` e `marketing_measurement`). As três ficam
sempre iguais (decisão E de 29/10/2026).

## Histórico

| Versão / data exibida | Onde | Conteúdo | Situação |
|---|---|---|---|
| Cookies: 22/08/2026 | main (produção) e Preview (`dae52f7`) | Política de Cookies original (contato antigo contato@agenciacassiellos.com.br) | Publicada |
| Privacidade: 29/10/2026 | main (produção, `e998bf1`) | Seções 1–10 (inclui Google Calendar); contato cassiellosagencia@gmail.com | Publicada |
| Privacidade: 29/10/2026 (texto Turnstile) | Preview `feature/mini-crm-shark-scale` (`dae52f7`) | Texto da main + seção 10 (Cloudflare Turnstile) | Publicada no Preview |
| (rascunho) `LEGAL_POLICY_VERSION = 2026-10-29` | branch local `local/meta-pixel-prep` | v2 Meta Pixel: controlador, canal de privacidade, seção 11 (Meta Pixel; C2; revogação; CAPI inativa; sem remarketing), Política de Cookies v2 | **Não publicada** — a data será trocada pela data efetiva da publicação |

Observação: até esta etapa, o cadastro gravava `LEAD_POLICY_VERSION = 2026-08-22` para o
consentimento de contato, mesmo com o texto de 29/10 no Preview. Com a v2, as duas finalidades
passam a usar a mesma versão das políticas.

## Checklist de publicação (D3)

1. `legalPublicationBlockers()` vazio. Hoje faltam:
   - razão social e CNPJ (não inventar; preencher `LEGAL_CONTROLLER`);
   - confirmar o canal de privacidade (provisório: cassiellosagencia@gmail.com);
   - indicar o encarregado **ou** confirmar o enquadramento como agente de tratamento de pequeno porte
     (Res. CD/ANPD nº 2/2022). Não declarar dispensa sem essa confirmação;
   - definir o prazo de retenção dos registros de consentimento (não inventar prazo).
2. Revisão jurídica dos textos v2 aprovada.
3. `LEGAL_POLICY_VERSION` = dia efetivo da publicação (ex.: `2026-11-04`; segunda publicação no mesmo dia: `2026-11-04.2`).
4. Registrar a versão publicada na tabela acima (data, commit, o que mudou).
5. Se a Conversions API ou remarketing forem autorizados no futuro: atualizar finalidade, textos e aviso **antes** de ativar.

## Notas sobre agentes de pequeno porte (ANPD) — para a revisão jurídica

Resumo de fontes secundárias (não é parecer jurídico):
- Res. CD/ANPD nº 2/2022: microempresas, empresas de pequeno porte e startups podem ser "agentes de tratamento de
  pequeno porte", exceto se fizerem tratamento de alto risco, se a receita ultrapassar os limites da LC 123/2006
  (EPP até R$ 4,8 milhões/ano) ou se pertencerem a grupo econômico cuja receita global ultrapasse esses limites.
- Alto risco exige, cumulativamente, um critério geral (larga escala ou impacto significativo em direitos) e um
  específico (tecnologias emergentes, vigilância, decisões automatizadas, dados sensíveis ou de vulneráveis).
- Agentes de pequeno porte não são obrigados a indicar encarregado, mas devem manter um canal de comunicação com
  o titular.
- Res. CD/ANPD nº 18/2024 (atuação do encarregado): quando houver encarregado, nome (ou razão social) e contato
  devem estar publicados em local de fácil acesso no site.
