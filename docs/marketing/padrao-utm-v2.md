# Padrão de UTMs v2 — preparado (decisões do titular em 25/11/2026)

**Estado:** U6, U7 e PR 5 decididos pelo titular em 25/11/2026. **Aplicar qualquer string abaixo em anúncio NÃO está autorizado.**
A v1 (`padrao-utm.md`, 30/10/2026) segue valendo até a aprovação final da v2 (U8). Nenhum anúncio, campanha, URL de destino ou
conta da Meta/Google foi alterado.

## 1. Decisões do titular

| Item | Decisão |
| --- | --- |
| U6 | **`utm_source=meta`** como padrão institucional e `utm_medium=paid_social`. Não identificar todo o tráfego como Facebook. |
| GA4 | Classificar corretamente o tráfego pago da Meta com **grupo de canais personalizado** (seção 5), em vez de mudar a fonte. |
| U7 | **SIM**: identificadores permanentes de campanha, conjunto e anúncio em parâmetros próprios. |
| PR 5 | **SIM**, como Draft. |
| Anúncio ativo | **NÃO AUTORIZADO** a aplicar. A string fica preparada. |
| `page_location` | Sanitização revista (seção 6). Preserva as UTMs necessárias; nada de identificador de clique nem dado pessoal. |

## 2. Macros disponíveis (validado na interface oficial, 25/11/2026)

No Gerenciador de Anúncios (conta "Cassiellos 01", editor do anúncio > Rastreamento > Parâmetros de URL > "Criar um parâmetro de URL",
lista aberta em modo somente leitura e fechada sem aplicar; o campo permaneceu vazio e a contagem de "Conferir e publicar" não mudou)
a lista suspensa oferece exatamente oito parâmetros dinâmicos:

`{{campaign.id}}`, `{{adset.id}}`, `{{ad.id}}`, `{{campaign.name}}`, `{{adset.name}}`, `{{ad.name}}`, `{{placement}}`, `{{site_source_name}}`.

Portanto `{{placement}}` e `{{site_source_name}}` **existem** na interface (a página técnica da API só lista os seis primeiros).
Valores de nome (`*.name`) ficam guardados em *snapshot* na primeira publicação (informação da documentação da API da Meta):
renomear depois não muda o link. **Os IDs são a chave de conciliação.**

## 3. String preparada (NÃO aplicada) para "Parâmetros de URL" do anúncio

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_source_platform=meta&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

- Diferente da proposta inicial só em `utm_source`: valor fixo `meta`, como decidido (a macro `{{site_source_name}}` devolveria `fb`, `ig`,
  `an` e `msg`, o que fragmentaria a fonte). A **plataforma real** fica em `utm_source_platform=meta` e o **posicionamento real** em
  `placement={{placement}}`; a macro `{{site_source_name}}` pode ser usada como `utm_term` ou em parâmetro extra se o titular quiser
  separar Facebook, Instagram, Audience Network e Messenger (não incluída, decisão futura).
- O destino do anúncio não muda (`https://crm.cassiellos.com.br/formularios/hamburguerias`, sem parâmetros próprios), logo não há parâmetro duplicado.
  Se algum dia houver `utm_*` no destino, vale a primeira ocorrência.
- Antes de aplicar (com autorização): conferir na própria tela o aviso sobre nova revisão e reinício da fase de aprendizado, e testar o link
  com "Pré-visualizar anúncio" e com o cadastro de teste.

## 4. Parâmetros: papel e destino

| Parâmetro | Papel | Site (este PR) | GA4 |
| --- | --- | --- | --- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | padrão | já gravados | nativos |
| `utm_id` | ID permanente da campanha | **gravado**, 15–20 dígitos ou `chave-número` | nativo: "ID da campanha" da sessão |
| `utm_source_platform` | plataforma de origem | **gravado**, minúsculas | nativo: "Plataforma de origem" da sessão |
| `adset_id`, `ad_id` | IDs permanentes do conjunto e do anúncio | **gravados**, mesmo formato dos IDs | parâmetro de evento + dimensão personalizada (seção 6.3) |
| `placement` | posicionamento legível | **gravado**, texto curto | parâmetro de evento + dimensão personalizada |

Formato estrito no navegador e no servidor: ID fora de 15–20 dígitos (ou `chave-número`) é descartado (remove telefone, CPF, CNPJ, CEP);
e-mail (também `%40`), script e símbolos são descartados; tamanho limitado. A estrutura continua `answers.attribution`; sem migração.
O backend anterior descartava as cinco chaves novas: **não suportava**; este PR é a modificação necessária.

## 5. Grupo de canais personalizado no GA4 (Paid Social da Meta)

No grupo padrão do GA4, "Paid Social" exige fonte na lista social do Google (`facebook`, `fb`, `instagram`, `ig`, `messenger`, `whatsapp`) e meio que case
com `^(.*cp.*|ppc|retargeting|paid.*)$`. `meta` não está na lista: com `utm_source=meta` o padrão classifica como **Paid Other**.
Solução decidida: um grupo personalizado, sem mexer na fonte.

GA4 > Administrador > Exibição de dados > Grupos de canais > Criar novo grupo de canais > nome **"Cassiellos — Canais"** > "Copiar do grupo padrão" e então,
**no topo da lista** (a ordem importa), adicionar o canal:

| Canal | Condições (todas) |
| --- | --- |
| **Paid Social — Meta** | `Origem da sessão` corresponde a regex `^(meta|facebook|fb|instagram|ig|an|msg|messenger|audience_network)$` **E** `Meio da sessão` corresponde exatamente a `paid_social` |

Mantém os demais canais copiados. Grupos personalizados valem também para o histórico e não alteram os dados coletados (reversível: basta apagar o grupo).
O CRM já classifica `meta` + `paid_social` como "Anúncios da Meta" (`attributionChannel`), sem alteração.

## 6. `page_location` do GA4: sanitização e identificadores de clique

### 6.1 Problema

A tag do Google do contêiner (rascunho em `GTM-T7JCRBW4`) não sobrescreve `page_location`; o GA4 receberia a URL completa, inclusive `fbclid`,
`gclid` e qualquer parâmetro estranho (e-mail, telefone, nome colocados por terceiros). O `page_referrer` também pode trazer consulta
(por exemplo, redirecionador de links do Instagram).

### 6.2 Regra

- **`page_location`** = origem + caminho + **somente** chaves de atribuição válidas (UTMs e as cinco estendidas, com o formato estrito da seção 4).
  Fragmento (`#`), `fbclid`, `msclkid`, `ttclid`, `_gl`, outros identificadores e qualquer parâmetro desconhecido são removidos. Repetido: vale o primeiro.
- **`page_referrer`** = origem + caminho (sem consulta nem fragmento).
- Implementação: variáveis de JavaScript personalizado do GTM com o texto versionado em `docs/tracking/gtm/page-location-sanitizado.js` e
  `page-referrer-sanitizado.js`, espelho das funções `ga4PageLocation` e `ga4PageReferrer` (`lib/privacy/url-sanitize.ts`).
  O teste `lib/privacy/ga4-page-location.test.ts` executa o **texto exato das variáveis** contra 13 URLs e exige o mesmo resultado das funções do site.
- Defesa em profundidade (opcional): GA4 > Administrador > Fluxos de dados > fluxo web > Configurar configurações de tag > Mostrar tudo >
  "Editar dados" / ocultação de dados: parâmetros de consulta de URL a ocultar (`fbclid`, `gclid`, …). Só reforça; a regra principal é a do GTM.

### 6.3 Como aplicar no GTM (espaço de trabalho de rascunho existente; sem reimportar; sem publicar; só com autorização)

1. Variáveis > Novo > JavaScript personalizado: **"JS | page_location sanitizado"** (cole `page-location-sanitizado.js`) e **"JS | page_referrer sanitizado"** (cole `page-referrer-sanitizado.js`).
2. Tag "Google" (configuração do GA4) > Configuração > Configurações de configuração > adicionar `page_location` = `{{JS | page_location sanitizado}}` e `page_referrer` = `{{JS | page_referrer sanitizado}}`.
3. Parâmetros de atribuição como parâmetros de evento (para comparar campanha, conjunto, anúncio e posicionamento): três variáveis JavaScript personalizadas
   a partir de `docs/tracking/gtm/atribuicao-parametro.js` (mude só a linha `var KEY = ...` para `adset_id`, `ad_id` e `placement`) e, na mesma tag,
   adicionar os parâmetros `adset_id`, `ad_id`, `placement`.
4. GA4 > Administrador > Definições personalizadas > Criar dimensão personalizada (escopo: evento) para `adset_id`, `ad_id` e `placement`.
5. Conferir no GTM Preview e no DebugView: a URL do evento não traz `fbclid`/`gclid`/parâmetros desconhecidos e os três parâmetros aparecem.

### 6.4 Identificadores oficiais de clique (Google Ads futuro): estratégia condicionada

| Fase | Condição | `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid` |
| --- | --- | --- |
| **Hoje** | sem campanha no Google Ads; sinais de anúncios do Google **negados**; política de privacidade ainda não cita o Google Ads | removidos do `page_location` do GA4; o cadastro/CRM também não os guarda |
| **Preparação** | texto de privacidade e aviso citam o Google Ads (aprovação jurídica); Consent Mode com `ad_storage`, `ad_user_data`, `ad_personalization` seguindo a escolha de marketing (`consentModeFrom(..., { googleAdsSignals: true })`, já implementado e desligado); GA4 vinculado ao Google Ads; marcação automática ligada | ainda removidos |
| **Ativo** | consentimento de anúncios concedido pelo visitante | passam ao GA4 (interruptor `ALLOW_GOOGLE_CLICK_IDS` na variável, hoje `false` e coberto por teste, passa a depender de um valor do `dataLayer` que o código do consentimento envia só quando `ad_storage` é concedido); `fbclid` continua nunca indo ao GA4 |
| **Sem consentimento** | visitante recusou anúncios | nenhum identificador é lido nem enviado; o Consent Mode básico trata a medição agregada |

A marcação automática do Google Ads (`gclid`) **não é afetada na URL do anúncio**: ela continua no link; apenas o que o nosso GTM envia ao GA4 e o que o CRM guarda é filtrado.
Guardar `gclid` no CRM (importação offline de conversões) é decisão futura, com texto de privacidade e consentimento próprios.

## 7. Preservação até o cadastro e o agendamento

1. O anúncio abre `/formularios/hamburguerias?...` com os parâmetros.
2. No envio do contato, o formulário lê `window.location.search` (auxiliar único `attributionFromSearch`) e manda só as chaves da lista.
3. O servidor higieniza de novo (`sanitizeAttribution`) e grava em `form_submissions.answers.attribution`, junto com o lead.
4. O calendário embutido usa o lead já criado; `/agendar` usa o mesmo auxiliar.
5. Repetido: vale a primeira ocorrência. `fbclid` só com consentimento de marketing; apagado na revogação.

## 8. Meta × GA4 × CRM

| Fonte | O que conta | Limite |
| --- | --- | --- |
| Meta | cliques e conversões modelados, janelas de atribuição da Meta | não vê quem não carregou o Pixel (depende de consentimento de marketing) |
| GA4 | sessões e eventos de quem aceitou métricas | exclui quem recusou ou não escolheu |
| CRM | cadastros e reuniões confirmados pelo servidor | única fonte completa de leads; atribuição vem dos parâmetros gravados no envio |

Concilie por `ad_id` e `utm_id`. A divergência entre as três é indicador de cobertura de consentimento, não erro a corrigir.

## 9. Padrões dos demais canais (propostos)

| Canal | `utm_source` | `utm_medium` | Observações |
| --- | --- | --- | --- |
| Google Ads | `google` | `cpc` | sufixo do URL final como na v1 (`cid-{campaignid}__agid-{adgroupid}__ad-{creative}` em `utm_content`); marcação automática ligada |
| Instagram orgânico (bio, posts) | `instagram` | `organic_social` | GA4: Organic Social |
| Facebook orgânico | `facebook` | `organic_social` | GA4: Organic Social |
| WhatsApp (mensagem enviada) | `whatsapp` | `messaging` | `whatsapp` está na lista social do Google |
| E-mail | `email` | `email` | como na v1 e no CRM; lista/campanha em `utm_campaign`; nunca ID de contato nem e-mail do destinatário |
| Parceiro | `parceiro_<empresa>` | `referral` | como na v1 |

## 10. Pendências

- **U8:** aprovar a v2 e substituir a v1.
- **Aplicação no anúncio:** exige autorização específica do titular (nada foi aplicado).
- **Criar o grupo de canais e editar o GTM/GA4:** exigem autorização (seções 5 e 6.3).
