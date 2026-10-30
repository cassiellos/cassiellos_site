# Textos jurídicos — histórico, retenção e checklist de publicação

Fonte única da versão: `LEGAL_POLICY_VERSION` em `lib/legal/policy.ts`. A mesma data aparece em três lugares:
- como "Última atualização" na Política de Privacidade;
- como "Última atualização" na Política de Cookies;
- em `crm.consents.policy_version`, por meio de `CRM_POLICY_VERSION`.

## Histórico

| Versão | Onde | Conteúdo | Situação |
|---|---|---|---|
| Cookies 22/08/2026 | main e Preview | Política de Cookies original (contato antigo `contato@agenciacassiellos.com.br`) | Publicada |
| Privacidade 29/10/2026 | main e Preview (com a seção Turnstile) | Seções 1–11 | Publicada |
| **v3 — 30/10/2026** (`LEGAL_POLICY_VERSION = 2026-10-30`) | Preview (`feature/mini-crm-shark-scale`) | Ver a lista abaixo; aprovada pelo responsável em 30/10/2026 (D5, rev. 3) | Publicada no Preview com este commit. A main não foi alterada |

O que muda na v3:
- controlador (razão social e CNPJ);
- canal de privacidade e enquadramento de pequeno porte;
- métricas com consentimento (Etapa 3);
- seção 11, Meta Pixel;
- retenção dos registros de consentimento;
- aviso de marketing aprovado;
- direitos dos titulares (art. 18) e Google Calendar sem convite (seção 9).

## Controlador (conferido em 30/10/2026)

O cadastro público do CNPJ (receitaws, espelho da Receita Federal, atualizado em 13/10/2026) mostra:
- CASSIELLOS COMUNICACAO E SERVICOS DIGITAIS LTDA, nome fantasia AGENCIA CASSIELLOS;
- CNPJ 67.311.701/0001-12;
- situação ATIVA desde 08/06/2026;
- porte Microempresa, optante do Simples;
- CNAE 73.11-4-00 (agências de publicidade);
- Belo Horizonte/MG.

Os dígitos verificadores foram conferidos.

O texto só exibe esses dados com `identificationConfirmed: true`, ou seja, depois da aprovação do responsável.

## Agente de tratamento de pequeno porte (Res. CD/ANPD nº 2/2022) — confirmado em 30/10/2026

| Requisito | Situação |
|---|---|
| Art. 2º: microempresa registrada | Sim: cadastro ATIVO, porte Microempresa, Ltda |
| Art. 3º, II: receita bruta até o limite do art. 3º, II, da LC 123/2006 | Sim. Informada pelo responsável: R$ 15–20 mil/mês, cerca de R$ 180–240 mil/ano. Também abaixo do limite proporcional do ano de início (abertura em 08/06/2026) |
| Art. 3º, III: sem grupo econômico acima do limite | Sim, confirmado pelo responsável |
| Art. 3º, I e art. 4º: sem alto risco (um critério geral **e** um específico) | Nenhum critério geral (pequena escala; sem impacto significativo) nem específico (sem tecnologia emergente, vigilância, decisão automatizada ou perfilamento pela controladora, dados sensíveis ou de crianças, adolescentes e idosos) |
| Art. 11: canal com o titular | cassiellosagencia@gmail.com, confirmado como monitorado (D2, 30/10/2026) |
| Art. 5º: comprovação | Em até 15 dias, se a ANPD pedir: guardar este registro e os comprovantes de receita |

Reavaliar se houver mudança de receita, de grupo econômico ou de tratamento (por exemplo: públicos, remarketing ou CAPI).

## Retenção dos registros de consentimento — decisão D4 (30/10/2026)

A LGPD **não fixa** prazo para guardar registros de consentimento. Os 5 anos são uma **decisão da controladora**, documentada aqui, e não um prazo obrigatório.

| Item | Onde | Prazo | Eliminação |
|---|---|---|---|
| Escolha de cookies (`cassiellos_consent`) | Navegador | Até 180 dias | Expira sozinha (o aviso reaparece); o visitante pode apagar |
| `_fbp` / `_fbc` | Navegador (Meta Pixel) | Cerca de 90 dias | Removidos pelo site na recusa ou revogação; nunca vão ao CRM (C2) |
| Consentimento vigente | `crm.consents` | Enquanto a autorização estiver vigente e houver finalidade | Fim da finalidade ou pedido de eliminação do cadastro |
| Evidência mínima de autorização revogada (finalidade, decisão, datas, versão; **sem** respostas do formulário, cookies, IP ou identificadores) | `crm.consents` (`revoked_at`) + atividade de revogação | **Até 5 anos** após a revogação, só enquanto houver fundamento | Revisão semestral; eliminação antecipada quando deixar de ser necessária; junto com o cadastro, se houver pedido de eliminação, salvo processo em andamento |

**Conferência com os arts. 15 e 16 da LGPD**
- **Art. 15, III:** a revogação do consentimento (art. 8º, §5º) **encerra** o tratamento para a finalidade autorizada. Nada mais é enviado à Meta e o `fbclid` é apagado na hora.
- **Art. 16:** encerrado o tratamento, os dados são eliminados. A conservação só é admitida nas hipóteses do artigo.
  - A que se aplica é a do **inciso I**: cumprimento de obrigação legal ou regulatória pela controladora.
  - A obrigação vem do **art. 8º, §2º** (cabe à controladora provar que o consentimento foi obtido conforme a lei) e do **art. 37** (manter registro das operações de tratamento).
  - O registro mínimo da autorização e da revogação é o que permite cumprir essas obrigações.
- **Art. 7º, VI:** quando houver processo judicial, administrativo ou arbitral, a guarda também se ampara no exercício regular de direitos.
  - O art. 16 **não** cita essa hipótese de forma expressa. Por isso o texto público prende a conservação à demonstração de conformidade e ao uso em processos, e não a uma guarda genérica.
- **Minimização (art. 6º, III):** só a evidência mínima. As respostas do formulário e os dados de contato **não** são guardados como prova de consentimento.

**Por que até 5 anos** (justificativa; não é exigência legal)
- O tratamento autorizado termina na revogação.
- 5 anos é o prazo de prescrição da ação punitiva da Administração Pública Federal (Lei nº 9.873/1999, art. 1º), aplicável à ANPD. É, portanto, o maior período em que a controladora pode precisar demonstrar que aquele tratamento teve consentimento válido.
- O prazo cobre também pretensões civis (Código Civil, art. 206, §3º, V; CDC, art. 27, se houver relação de consumo).
- É um **limite máximo**: a revisão semestral elimina antes o que não tiver mais fundamento.

**Revisão semestral (procedimento manual)**
1. Consulta somente leitura das autorizações revogadas e dos cadastros eliminados a pedido.
2. Eliminar a evidência que passou de 5 anos ou que não tem mais fundamento (sem processo, sem fiscalização em curso).
3. Registrar data, responsável e quantidade, sem dados pessoais no registro.

A eliminação automática é uma pendência técnica registrada. Nenhum registro atinge 5 anos antes de 2031.

## Checklist de publicação

1. Aprovação da versão final (aviso e políticas).
2. Em `lib/legal/policy.ts`:
   - `identificationConfirmed`, `privacyChannelConfirmed` e `consentRetentionDefined` = `true`;
   - `smallAgentStatusConfirmed` = `true` **somente** com a confirmação de receita e grupo econômico (ou um encarregado indicado);
   - `legalPublicationBlockers()` vazio.
3. `LEGAL_POLICY_VERSION` = dia efetivo da publicação.
4. Registrar a versão publicada na tabela acima.
5. Só depois disso: `META_PIXEL_ENABLED=true` e `META_PIXEL_ID=28992534033707610` no Preview, e novo deploy.
