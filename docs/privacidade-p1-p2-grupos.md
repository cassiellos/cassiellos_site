# Privacidade P1/P2 — grupos para integração (A1–A6)

Branch local `local/privacy-split-prep` (base `dae52f7`). O commit original `5c0290f` (`local/privacy-p1p2-prep`) foi
**preservado sem alteração**. Nada foi publicado.

## Commits

| Commit | Grupo | Conteúdo | Escopo / destino |
|---|---|---|---|
| `62601b1` | base | Funções de higienização, escopo CRM × site, política por canal e 4 chaves **desligadas**. **Sem mudança de comportamento.** | Pré-requisito de todos |
| `3958546` | **(a)** | Liga `VERCEL_MINIMIZE_CRM`: Vercel Analytics (origem + caminho + UTMs) e Speed Insights (origem + caminho) no funil `/agendar` e no painel `/crm`, `/mini-crm` | CRM Preview — etapa 3 |
| `4930cce` | (a-inst) | Liga `VERCEL_MINIMIZE_SITE`: o mesmo nas páginas institucionais | main — autorização específica |
| `1deae34` | **(b)** | Liga `FLOW_MINIMIZE_CRM`: AnalyticsFlow com `gclid`/`fbclid` = null e UTMs higienizados no funil e painel | CRM Preview — etapa 3 |
| `f857a96` | (c) | Liga `FLOW_MINIMIZE_SITE`: o mesmo no site institucional | main — após verificar o cassiellOS |
| `1e9968a` | (d) | Formulário institucional → n8n: `page_url`/`referrer` só com origem + caminho; UTMs higienizados | main — após verificar o n8n |

O "(a-inst)" separa a parte institucional que estava dentro de "Vercel Analytics e Speed Insights" no `5c0290f`,
para cumprir a decisão A2: o grupo (a) vale só para o escopo do CRM.

**Independência verificada:** cada grupo aplicado sozinho sobre a base, e a combinação (a)+(b), passa na verificação
de tipos e nos testes. Cada grupo liga apenas a própria chave, em arquivo próprio, e tem teste em arquivo próprio.
Com todos os grupos aplicados, o comportamento equivale ao do `5c0290f`.

**Pacote da etapa 3 (A2):** base `62601b1` + (a) `3958546` + (b) `1deae34`. A integração não foi iniciada.

## Conflitos previstos com o Meta Pixel (etapa 4)

Teste de mesclagem local, descartado em seguida: pacote da etapa 3 + `dd6453c`.

| Arquivo | Conflito | Resolução proposta |
|---|---|---|
| `app/layout.tsx` | O Pixel troca `<Analytics/>` por `PrivacyAnalytics` (fbclid só no funil) e adiciona `<MetaPixel/>`; a base troca por `AnalyticsPrivacy` | Manter `AnalyticsPrivacy`, que cobre o fbclid e o gclid; manter `<MetaPixel/>` e a configuração do Pixel; retirar `PrivacyAnalytics` |
| `components/site-interaction-tracker.tsx` | O Pixel anula o fbclid no funil dentro de `attribution()`; a base delega para `flowAttribution()` | Manter `flowAttribution()`, mais restritiva e coerente com a G2 |
| Teste G2 (navegador) | O caso E espera fbclid no AnalyticsFlow/Vercel em páginas institucionais | Continua válido enquanto (a-inst)/(c) não estiverem integrados. Atualizar o caso E quando forem integrados |

O Pixel em si não é afetado: o fbclid permanece no endereço do navegador (cookie `_fbc` com consentimento), e o CRM
continua guardando o fbclid só com consentimento (G2).

## Decisões registradas

- **A1** — separação em commits independentes: feita.
- **A2** — etapa 3 = base + (a) + (b); integração **não** iniciada.
- **A3** — (c) e (d) separados; dependem de verificar o cassiellOS e o n8n e de autorização para a main.
- **A4 — adiado (proposta registrada):** quando houver gclid e nenhum UTM, preencher `utm_source=google`/`utm_medium=cpc`
  sem transmitir o identificador. Não implementado. Tráfego sem UTM e de origem desconhecida não é classificado
  automaticamente como orgânico.
- **A5** — checklist em `docs/marketing/checklist-atribuicao-google-meta.md`; nenhuma conta foi alterada.
- **A6** — padrão de UTMs em `docs/marketing/padrao-utm.md`.

## Dependências não verificadas

1. **cassiellOS:** armazenamento, retenção e uso de gclid/fbclid e UTMs (sem acesso ao repositório: GitHub 403;
   endpoint de produção não consultado).
2. **n8n:** se o fluxo do formulário lê dados da consulta de `page_url` ou do referrer (conector indisponível nesta sessão).
3. **Campanhas:** se Google Ads e Meta têm UTMs configurados (checklist A5).

## Decisões B1–B5 (30/10/2026)

- **B1 — aprovado:** (a-inst) permanece separado de (a); as alterações institucionais ficam reservadas para a main,
  com autorização específica.
- **B2 — confirmado:** etapa 3 = base `62601b1` + (a) `3958546` + (b) `1deae34`. Integração **não** executada. Antes
  dela: conferir dependências e resolver os conflitos com o Meta Pixel sem alterar seu comportamento.
- **B3 — aprovação conceitual** dos princípios de UTMs. A aprovação definitiva de `docs/marketing/padrao-utm.md`
  depende do resumo e dos pontos de decisão apresentados à Cassiellos.
- **B4 — responsabilidades:** Claude prepara o checklist técnico; a Cassiellos confere as configurações reais do
  Google Ads e da Meta, com orientação, após o teste das 09h40 e de preferência antes da ativação pública do Pixel.
  Nenhuma campanha ou parâmetro será alterado sem autorização.
- **B5 — conferência manual:** depois do teste das 09h40, auditoria somente leitura do cassiellOS e do n8n pelos
  acessos já autorizados. Sem novas permissões, sem contornar o HTTP 403, sem modificar serviços externos.

## Padrão de UTMs v1 — decisões U1–U5 (30/10/2026)

Aprovado e registrado em `docs/marketing/padrao-utm.md` (seção 7); checklist alinhado. Resumo: U1 `meta` para pago e
`instagram`/`facebook` para orgânico, pelo contexto real do link; U2 `paid_social` (Meta), `cpc` (Google),
`organic_social` (orgânico); U3 `utm_campaign` legível e IDs com chaves em `utm_content`; U4 só campanhas novas,
ativas auditadas antes de migrar; U5 `parceiro_<empresa>` + `referral`.
