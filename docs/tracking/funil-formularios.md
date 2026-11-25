# Mensuração do funil de formulários (CRM Cassiellos)

Plano de medição, contrato de eventos e roteiro de homologação do funil
`/formularios/[slug]` (e, por tradução determinística, do `/agendar`).

**Estado desta entrega: tudo desligado por padrão.** O código emite eventos no `dataLayer` apenas para visitantes que
autorizaram "métricas", e o Google Tag Manager só carrega com `TRACKING_GTM_ENABLED=true` e um
`GTM_FORM_CONTAINER_ID` válido. Nada foi criado nem publicado em GTM, GA4 ou Google Ads.

## 1. O que foi encontrado na auditoria

| Achado | Efeito |
| --- | --- |
| A campanha ativa é do **Meta Ads** ("SC \| C01 \| VENDAS \| HAMBURGUERIAS \| AGENDAMENTOS", otimizada para `Cassiellos_Scheduled`) e leva a `/formularios/hamburguerias`. A conta do Google Ads não tem campanha ativa ou pausada. | A premissa "cliques do Google Ads" precisa ser corrigida: o funil é medido contra o Meta. |
| Nenhum GA4 nem GTM da Cassiellos existe (só ativos de clientes). | Há o que criar, mas criar conta/propriedade exige autorização. |
| O consentimento só aparece pelo link do rodapé em `/formularios` (decisão de "entrada limpa" travada por testes). | Quem nunca abriu as preferências não autoriza nada: Pixel, CAPI (Lead/Schedule), Vercel Analytics e AnalyticsFlow ficam sem dado. **É a principal explicação provável para "40 cliques e nenhum dado".** |
| O Vercel Web Analytics está desligado no projeto `cassiellos-crm`. | Sem contagem própria de visualizações. |
| O contador global (`site-interaction-tracker`) tratava **cada pergunta respondida** como `form_submit`/`cta_click`. | Contagem de "envios" inflada e sem relação com leads reais. Corrigido: `/agendar` e `/formularios` têm métricas próprias (`ownsFunnelMetrics`). |

A fonte de verdade para leads e reuniões reais continua sendo o banco do CRM. As ferramentas de anúncio e de
analytics enxergam só quem consentiu e nunca devem ser tratadas como equivalentes ao CRM sem conciliação.

## 2. Regras do rastreamento

1. **Um único emissor** (`lib/tracking/datalayer-client.ts`, `pushTrackingEvent`). Ninguém chama `dataLayer`/`gtag`
   diretamente.
2. **Consentimento primeiro.** Sem a autorização de "métricas" nada é enviado, guardado ou carregado. Recusa ou
   revogação interrompem as coletas na hora e limpam os cookies do Google (`_ga`, `_ga_*`, `_gid`, `_gat*`, `_gcl_*`).
3. **Sem dados pessoais.** Só os parâmetros da seção 4 passam (lista fechada). Respostas, texto digitado, nome, e-mail,
   telefone, identificadores e links privados do Meet nunca entram no evento.
4. **Prévia do painel nunca emite** (`environment_mode=preview`).
5. **Teste × real.** `environment_mode` é `live` ou `test`. Vem do servidor (`CRM_BOOKING_MODE`, lista de e-mails de teste
   e a resposta de criação do lead). Relatórios de negócio filtram `environment_mode = live`.
6. **Lead só depois do servidor.** `generate_lead` sai quando a API devolve `ok` e `reused !== true`.
   **Reunião só depois do servidor.** `booking_meeting_confirmed` sai quando `/api/booking/confirm` confirma e
   `alreadyConfirmed !== true`. Cliques, mudanças de URL e botões nunca são prova de conversão.
7. **Sem duplicidade.** Eventos únicos por formulário (entrada, início, calendário), por etapa (visualização/conclusão),
   por código (erros) ou por referência técnica com hash (envio, lead, horários, reunião). A chave de deduplicação
   fica em `sessionStorage` (`cassiellos_dl_sent`) e **não guarda a referência**.
8. **Eventos antigos do `/agendar` preservados.** A ponte `cassiellos:funnel → dataLayer` traduz cada evento
   `booking_*` para o contrato (tabela em `funnel-contract.ts`, `mapLegacyFunnelEvent`) sem emitir duas vezes.

## 3. Mapa do funil e eventos

| Etapa | Evento | Quando dispara |
| --- | --- | --- |
| Entrada | `page_view` (tag do Google) | Carregamento da página, já com consentimento |
| | `form_view` | Formulário exibido (capa ou 1ª pergunta) |
| | `form_start` | Primeira interação real (botão da capa ou 1ª resposta) |
| | `form_cover_cta_click` | Clique no botão da capa |
| Perguntas | `form_step_view` | Pergunta exibida (uma vez por etapa) |
| | `form_step_complete` | Resposta válida e avanço |
| | `form_step_back` | Voltar |
| | `form_validation_error` | Resposta recusada pela validação (`validation_error_code`) |
| Captação | `lead_submit_attempt` | Envio dos dados de contato |
| | `generate_lead` | **Após** a API confirmar a criação |
| | `lead_submit_error` | Falha do envio (rede, API, limite, verificação) |
| Calendário | `booking_calendar_view` | Calendário exibido |
| | `booking_calendar_load_error` | Calendário/horários indisponíveis |
| | `booking_date_selected` | Dia escolhido |
| | `booking_slots_loaded` / `booking_no_slots` | Horários retornados / dia sem horário |
| | `booking_slot_selected` | Horário escolhido |
| Conclusão | `booking_submit_attempt` | Pedido de confirmação enviado |
| | `booking_meeting_confirmed` | **Após** confirmação real do servidor |
| | `booking_confirmation_error` | Falha na confirmação |

**Funil de relatório:** Visualizar → Iniciar → Pergunta 1 … Pergunta N → Contato → Lead criado → Calendário →
Horário → Reunião confirmada.

**Abandono** = diferença entre etapas observadas, em sessões únicas, calculada nos relatórios. Não há `beforeunload`.
O tempo entre etapas é calculado no relatório (agregado), nunca enviado como parâmetro.

## 4. Parâmetros permitidos

`form_id`, `form_version` (`v<N>`), `step_id`, `step_index`, `step_order`, `step_type`, `funnel_stage`
(`entry|questions|capture|calendar|conclusion`), `flow_variant` (`cover|plain`), `validation_error_code`
(código técnico em maiúsculas, nunca texto livre), `environment_mode` (`live|test`).

**Como identificar cada etapa, inclusive com ramificações.** `step_id` é o identificador técnico da etapa (nome fixo no
desenho do fluxo, nunca o texto da pergunta nem a resposta). `step_order` é a **posição fixa da etapa no desenho do fluxo**
(0 = primeira), igual para todos os visitantes; é com ele que o funil do GA4 sai na ordem certa. `step_index` é a posição
no **caminho que aquele visitante percorreu** (muda se ele voltar ou seguir uma ramificação). Etapas de desfecho
alcançáveis por mais de uma pergunta (por exemplo "limited") têm um único `step_id` e um único `step_order`.

`sanitizeTrackingParams` descarta qualquer outro campo e qualquer valor com `@`, espaços ou sequência de 6 ou mais
dígitos.

## 5. Consent Mode v2 e LGPD

* `consent default` com os quatro sinais **negados** é empurrado antes de qualquer script do Google.
* O visitante escolhe no aviso do CRM (cookie `cassiellos_consent`). `analytics_storage` acompanha "métricas".
* **`ad_storage`, `ad_user_data` e `ad_personalization` ficam negados** enquanto o texto de marketing cobrir só o Meta.
  Eles só passam a seguir a escolha de marketing quando a política de privacidade e o aviso citarem o Google
  (`consentModeFrom(..., { googleAdsSignals: true })`).
* Pendências jurídicas (não publicadas): mencionar GA4/Google Tag Manager (métricas), Google Ads (anúncios, se
  houver), ferramenta de comportamento (Clarity, se ativada), prazos de retenção, transferência internacional e como
  revogar.

## 6. Google Analytics 4 (a criar com autorização)

1. Propriedade da Cassiellos + fluxo web de `crm.cassiellos.com.br` (reaproveitar se já houver uma oficial; não
   existe hoje).
2. Retenção de dados em 14 meses; sinais do Google **desligados** até a política ser atualizada; coleta de dados de
   anúncios desligada.
3. Dimensões personalizadas (escopo de evento): `form_id`, `form_version`, `step_id`, `step_type`, `funnel_stage`,
   `flow_variant`, `validation_error_code`, `environment_mode`. Métricas personalizadas (escopo de evento, padrão):
   `step_order` e `step_index` (para ordenar e para ver a posição real percorrida).
4. Eventos-chave: `generate_lead` e `booking_meeting_confirmed`.
5. Filtro/segmento permanente `environment_mode = live` nas explorações e no Looker Studio.
6. Vincular a conta do Google Ads (sem alterar metas, lances ou conversões primárias).

## 7. Google Ads (proposta, nada alterado)

* **Primária proposta:** reunião confirmada (`booking_meeting_confirmed`). **Secundária:** lead válido
  (`generate_lead`).
* Evitar contagem em dobro: usar **ou** a tag nativa **ou** a importação do GA4 para cada conversão, nunca as duas.
* O container de rascunho inclui as tags `ADS | …` **pausadas e sem IDs**, só como modelo.
* Conversões avançadas somente na fase 2, com revisão jurídica. Sem mudança de estratégia de lance, metas, conversão
  primária ou orçamento sem autorização.

## 8. Microsoft Clarity (somente preparação)

Não ativar sem revisão de privacidade e autorização. Plano: máscara total de campos (`data-clarity-mask="true"` e
modo "strict"/mascarar tudo), nenhuma gravação no painel administrativo e em previews, carregar só com consentimento
de métricas e só em `/formularios` e `/agendar`, e citar a ferramenta na política antes de ligar.

## 9. Painel (proposta)

Exploração de funil no GA4 e, opcionalmente, Looker Studio com: sessões na entrada, `form_view`, `form_start`, etapa
a etapa, abandono por etapa, erros por código, calendário visto, dia/horário escolhido, tentativas e reuniões
confirmadas, por origem/UTM, dispositivo e `form_version`. Três colunas lado a lado, **sem declarar equivalência**:
cliques do Meta/Google Ads, GA4 (só consentidos) e registros do CRM (verdade). A diferença entre elas é um indicador
de cobertura de consentimento, não um erro a "corrigir".

## 10. Homologação antes de publicar

Marcar cada item com evidência (print do GTM Preview/Tag Assistant, DebugView, tempo real):

- [ ] Sem escolha de consentimento: nenhum script do Google, nenhum evento, `consent default` negado.
- [ ] Aceite de métricas: `gtm.js` carrega depois do `update`; um `form_view` por visita; sem repetição ao recarregar.
- [ ] Recusa e revogação: eventos param, cookies do Google removidos, `update` volta para negado.
- [ ] Desktop e celular; recarregar, voltar/avançar do navegador e troca de etapa não duplicam eventos.
- [ ] Pergunta intermediária **não** gera `generate_lead` nem `form_submit` no contador global.
- [ ] Envio duplo (duplo clique): um `lead_submit_attempt`, no máximo um `generate_lead`.
- [ ] Erro de API (400/403/409/429/5xx), Turnstile pendente e rede fora: `lead_submit_error`/`booking_*_error` com
      código, **sem** `generate_lead`/`booking_meeting_confirmed`.
- [ ] Reunião só é contada depois da resposta positiva; reabrir link já confirmado não conta de novo.
- [ ] Nenhum dado pessoal no `dataLayer`, nas requisições do GA4 nem no `sessionStorage`.
- [ ] Prévia do painel não emite. Testes e e-mails de teste saem como `environment_mode=test`.
- [ ] Sem duplicidade GTM × GA4 nativo × Meta × AnalyticsFlow.
- [ ] Testes automáticos (`npm test`) e `npx tsc --noEmit` limpos; build no preview da Vercel.

## 11. Ativação (após autorização)

1. Criar a propriedade GA4 e o container GTM; importar `gtm/cassiellos-formulario-gtm-RASCUNHO.json` em um espaço
   de trabalho novo (ver `gtm/README.md`) e trocar `G-XXXXXXXXXX`.
2. Variáveis de ambiente no projeto `cassiellos-crm`: `GTM_FORM_CONTAINER_ID=GTM-…` e `TRACKING_GTM_ENABLED=true`.
3. Validar no GTM Preview e no DebugView; só então publicar o container.
