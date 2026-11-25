# Evidências do funil: simulado, real e recebido pelo GA4

**Regra única:** só se escreve "o GA4 recebeu" quando o evento foi visto no DebugView ou no Tempo real do GA4. Tudo que
vem do código, de teste automatizado ou do navegador local é **simulado**. Hoje **nenhum evento foi recebido pelo GA4**:
a propriedade GA4 e o contêiner GTM existem desde 25/11/2026, mas o contêiner está **só em rascunho** e nenhuma página
com a tag foi aberta (seção 5).

## 1. Os três rótulos

| Rótulo | O que é | Fonte aceita | Hoje |
| --- | --- | --- | --- |
| **Real** | Aconteceu em produção | Dados do CRM e da Meta (somente leitura) e registros de execução da Vercel | 2 leads reais, 0 reuniões confirmadas, 1 timeout de conexão com o banco; Meta Ads: R$ 43,12, 2.018 impressões, 51 cliques no link (seção 5) |
| **GA4 recebido** | Chegou à propriedade GA4 | DebugView, Tempo real ou relatório do GA4, com captura de tela datada | 0 eventos |
| **Simulado** | Emitido por teste local, com dados fictícios | `npm test`, roteiro de navegador local (Playwright), lista de eventos do `dataLayer` local | 44 vistas de etapa, 35 concluídas, 6 erros provocados, 5 leads, 1 reunião (soma de 9 cenários) |

"n/d" significa que a origem não mede aquilo (o CRM não mede vista de pergunta nem abandono antes do envio). Zero no GA4
não é perda de visitantes: é ausência de propriedade e de tag em produção.

## 2. O que cada camada de teste prova (e o que não prova)

| Camada | Prova | Não prova |
| --- | --- | --- |
| `npm test` (1016 testes sem banco; 1219 com um PostgreSQL local descartável) | O código emite os 19 eventos do contrato, na ordem e com os parâmetros permitidos; nenhum dado pessoal sai | Que o navegador carregou o GTM, que o GA4 recebeu algo |
| Playwright em navegador local (14 cenários, 80 verificações) | O formulário real, rodando local, empurra os eventos certos no `dataLayer` e respeita o consentimento | Que a rede entregou o evento ao Google; só 9 cenários registram lista de eventos |
| GTM Preview | O contêiner (rascunho) dispara a tag certa para cada evento, sem publicar | Que o GA4 processou o evento |
| DebugView / Tempo real do GA4 | O evento chegou à propriedade, com os parâmetros esperados | Volume real de visitantes (precisa de produção) |

Somente o DebugView ou o Tempo real do GA4 pode mudar um número de "Simulado" para "GA4 recebido". O GTM Preview mostra que a
tag disparou, mas não que o GA4 recebeu; os testes automatizados e o navegador local nunca mudam o rótulo.

## 3. Como um número passa de simulado para recebido

1. ~~O titular aceita os termos do Google Analytics~~ (feito em 25/11/2026).
2. ~~Criar a propriedade GA4 e o contêiner GTM na conta Cassiellos, sem publicar~~ (feito, seção 5).
3. ~~Importar o rascunho `cassiellos-formulario-gtm-RASCUNHO.json` com o ID de medição real~~ (feito, 56 itens, sem publicar).
4. Abrir o Preview do GTM contra uma URL de pré-visualização do formulário e conferir os 19 eventos no DebugView.
5. Registrar, para cada evento visto: nome, horário, captura de tela do DebugView. Só então a coluna "GA4 recebido" do
   painel recebe o número, com data.
6. Eventos de visitantes reais só entram depois de publicação autorizada pelo titular.

## 4. O que fica fora de qualquer evidência

Respostas das perguntas, texto digitado, telefone, e-mail, nome, identificadores de visitante e links privados de reunião
não são rastreados nem aparecem em painel, log ou documento. O painel usa somente contagens, códigos técnicos e horários.

## 5. Estado das contas e leitura do Meta Ads (25/11/2026)

**GA4 e GTM (criados pelo titular, rascunho, nada publicado):** conta GA4 "Agência Cassiellos" (417437823); propriedade
"CRM Cassiellos - Formulários" (565800067); fluxo web "Formularios CRM Cassiellos" (16412511258); ID de medição
`G-ZTYQ9NHWEN`; contêiner GTM `GTM-T7JCRBW4` (conta 6407937203, container 288713672), espaço de trabalho Default com 56
itens pendentes (19 tags de evento GA4, 19 gatilhos, 10 variáveis, tag de configuração, 3 tags Ads pausadas). O contêiner
`GTM-TD5PQ37D` foi criado automaticamente pelo GA4 (Google tag gerenciada) e **não** deve ser instalado junto com o
`GTM-T7JCRBW4`. Dimensões personalizadas (escopo de evento): `form_id`, `form_version`, `step_id`, `step_type`,
`funnel_stage`, `flow_variant`, `validation_error_code`, `environment_mode`; métricas: `step_order`, `step_index`.
Eventos-chave (`generate_lead`, `booking_meeting_confirmed`) só podem ser marcados depois que o evento chegar ao GA4.

**Meta Ads, leitura em 25/11/2026, período 26/10 a 24/11/2026 (rótulo Real, fonte Meta; nada foi alterado):**

| Item | Valor |
| --- | --- |
| Conta de anúncios | Cassiellos 01 (368622509235308), portfólio Cassiellos |
| Campanha ativa | `SC \| C01 \| VENDAS \| HAMBURGUERIAS \| AGENDAMENTOS` (otimiza para `Cassiellos_Scheduled`); conjunto `SC \| CJ01 \| BRASIL \| 25-55`; anúncio `SC \| A01 \| HAMBURGUERIAS \| CRIATIVO-01` |
| Valor gasto | R$ 43,12 |
| Impressões / alcance / frequência | 2.018 / 1.668 / 1,21 |
| Cliques no link / cliques (todos) | 51 / 68 |
| CPC do link / CTR do link | R$ 0,85 / 2,53 % |
| Visualizações da página de destino | **não registradas (— no Gerenciador)** |
| Resultados `Cassiellos_Scheduled` na campanha | **— (nenhum atribuído)** |
| URL final do anúncio | `https://crm.cassiellos.com.br/formularios/hamburguerias` |
| Parâmetros de URL (UTMs) | **nenhum configurado** no anúncio |
| Conjunto de dados / Pixel | "Cassiellos \| CRM & Conversões" (28992534033707610); integrações: Pixel da Meta + API de Conversões; site `crm.cassiellos.com.br` |
| Eventos no conjunto de dados (28/10 a 24/11) | `PageView` 46 (navegador), `Programar` 9, `Lead` 6, `Cassiellos_Scheduled` 2, eventos `Chronos*` 5 (sem atividade há 21 dias) |

Como ler: os eventos do conjunto de dados incluem todas as origens (também testes internos e visitas que não vieram do
anúncio), então **não** equivalem a visitantes da campanha. Os 51 cliques no link não têm "visualizações da página de
destino" no Gerenciador; as hipóteses (Pixel só carrega com consentimento de marketing, saída antes do carregamento,
janela de atribuição) **não foram verificadas**. Sem UTMs, o GA4 não saberá separar a campanha da Meta de outro tráfego
social; recomendação (não aplicada, depende de autorização do titular porque altera o anúncio):
`utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`.
