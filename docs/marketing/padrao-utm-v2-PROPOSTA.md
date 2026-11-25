# Padrão de UTMs v2 — PROPOSTA (não aprovada; não substitui a v1)

**Estado:** proposta de 25/11/2026. A v1 (aprovada em 30/10/2026, `padrao-utm.md`) continua valendo até aprovação expressa.
**Nenhum anúncio, campanha, URL de destino ou conta da Meta/Google foi alterado.** Aplicar qualquer string abaixo em um
anúncio exige autorização específica do titular.

## 1. Por que revisar a v1 (fatos conferidos em 25/11/2026)

| Fato | Fonte | Consequência |
| --- | --- | --- |
| No grupo padrão de canais do GA4, "Paid Social" exige **fonte na lista social do Google** e `utm_medium` casando com `^(.*cp.*\|ppc\|retargeting\|paid.*)$` | Página oficial "Traffic-source dimensions" do GA4 | `utm_medium=paid_social` casa; a fonte precisa estar na lista |
| A lista oficial de fontes sociais do Google **contém** `facebook`, `fb`, `instagram`, `ig`, `messenger`, `whatsapp` e **não contém** `meta`, `an`, `msg`, `audience_network` | Arquivo "source categories" linkado na mesma página | `utm_source=meta` (v1) cai em **Paid Other**, não em Paid Social; `{{site_source_name}}` falha para Audience Network (`an`) e Messenger (`msg`) |
| A documentação da Meta lista 6 macros: `{{campaign.id}}`, `{{campaign.name}}`, `{{adset.id}}`, `{{adset.name}}`, `{{ad.id}}`, `{{ad.name}}`. `{{placement}}` e `{{site_source_name}}` **não aparecem** nessa página | developers.facebook.com, "URL tags for tracking" | Validar os dois na interface do Gerenciador de Anúncios antes de usar (pendente) |
| Valores por nome são guardados em *snapshot* na primeira publicação | mesma página da Meta | Renomear campanha/anúncio depois não muda o link: **IDs são a chave de conciliação** |

## 2. Decisão U6 — valor de `utm_source` para anúncios pagos da Meta

| Opção | Valor | GA4 (grupo padrão) | CRM hoje | Observação |
| --- | --- | --- | --- | --- |
| A | `meta` (v1) | Paid Other | reconhece (`meta_ads`) | exige um **grupo de canais personalizado** no GA4 para virar "Paid Social" |
| **B (recomendada)** | `facebook` | **Paid Social** | exige 1 linha no CRM: aceitar `facebook` + `paid_social` como `meta_ads` (hoje vira "Fora do padrão"; `facebook` + `organic_social` continua orgânico) | Instagram e demais posicionamentos separam-se por `placement`; plataforma fica em `utm_source_platform=meta` |
| C | `{{site_source_name}}` | Paid Social só para `fb` e `ig`; `an` e `msg` viram Paid Other | exige mapear `fb`, `ig`, `an`, `msg` | macro ainda não confirmada na interface |

## 3. String proposta (opção B) para "Parâmetros de URL" do anúncio

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_source_platform=meta&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

É a string do titular com **uma** diferença: `utm_source=facebook` no lugar de `{{site_source_name}}`. Para usar a macro, a opção C acima.
O destino do anúncio não muda (`https://crm.cassiellos.com.br/formularios/hamburguerias`, sem parâmetros próprios, conferido na leitura do anúncio
em 25/11/2026), então não há parâmetro duplicado. Se algum dia o destino tiver `utm_*`, vale a primeira ocorrência.

## 4. Parâmetros, o que cada um faz e onde chega

| Parâmetro | Papel | Site (este PR) | GA4 |
| --- | --- | --- | --- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | padrão | já gravados | nativos |
| `utm_id` | ID permanente da campanha | **gravado (novo)**, 15–20 dígitos ou `chave-número` | campo de ID de campanha (confirmar em Aquisição) |
| `utm_source_platform` | plataforma de origem (`meta`, `google`) | **gravado (novo)**, minúsculas | campo de plataforma de origem (confirmar) |
| `adset_id`, `ad_id` | IDs permanentes do conjunto e do anúncio | **gravados (novos)**, mesmo formato dos IDs | não nativos: variável de URL no GTM + parâmetro de evento + dimensão personalizada (a fazer, no contêiner existente) |
| `placement` | posicionamento legível | **gravado (novo)**, texto curto | não nativo, idem |

Formato estrito no navegador **e** no servidor: ID fora de 15–20 dígitos (ou `chave-número`) é descartado, o que remove telefone, CPF, CNPJ e CEP;
e-mail (inclusive `%40`), script e símbolos são descartados; tamanho limitado. Nada novo em tabela: a estrutura continua `answers.attribution`.

## 5. Preservação do link até o cadastro e o agendamento

1. O anúncio abre `/formularios/hamburguerias?...` com os parâmetros.
2. No envio do contato, o formulário lê `window.location.search` (um único auxiliar, `attributionFromSearch`) e manda só as chaves da lista.
3. O servidor higieniza de novo (`sanitizeAttribution`) e grava em `form_submissions.answers.attribution`, junto com o lead.
4. O calendário embutido usa o lead já criado: a atribuição não precisa ser reenviada. `/agendar` usa o mesmo auxiliar.
5. Parâmetro repetido: **vale a primeira ocorrência**.

## 6. Identificadores de clique

- `fbclid`: só com consentimento de marketing; o servidor apaga sem consentimento e na revogação (como antes).
- `gclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`, `yclid`…: **não são coletados** pelo cadastro. O navegador deixa de enviar `gclid` (o servidor já o descartava).
- **Lacuna aberta no GA4:** a tag do Google do contêiner atual não sobrescreve `page_location`, então o GA4 recebe a URL completa, inclusive `fbclid`.
  Correção proposta (não aplicada, exige autorização por alterar o contêiner): variável personalizada no GTM que remove `CLICK_ID_PARAMS`
  e mantém as chaves de atribuição, usada como `page_location` da tag. Com Google Ads no futuro, reavaliar: o auto-tagging (`gclid`) deve continuar ativo
  e só vale para quem consentir anúncios.

## 7. Meta × GA4 × CRM (por que os números não batem)

| Fonte | O que conta | Limite |
| --- | --- | --- |
| Meta | cliques e conversões modelados, janelas de atribuição da Meta | não vê quem não carregou o Pixel (depende de consentimento) |
| GA4 | sessões e eventos de quem aceitou métricas | exclui quem recusou ou não escolheu |
| CRM | cadastros e reuniões confirmados pelo servidor | única fonte completa de leads; atribuição vem dos parâmetros gravados no envio |

Conciliar por `ad_id` / `utm_id`; divergência entre as três é indicador de cobertura de consentimento, não erro a "corrigir".

## 8. Padrões para os demais canais (propostos)

| Canal | `utm_source` | `utm_medium` | Observações |
| --- | --- | --- | --- |
| Google Ads | `google` | `cpc` | sufixo do URL final como na v1 (`cid-{campaignid}__agid-{adgroupid}__ad-{creative}` em `utm_content`); auto-tagging ligado |
| Instagram orgânico (bio, posts) | `instagram` | `organic_social` | GA4: Organic Social |
| Facebook orgânico | `facebook` | `organic_social` | GA4: Organic Social |
| WhatsApp (mensagem enviada) | `whatsapp` | `messaging` | `whatsapp` está na lista social: o GA4 tende a classificar como Organic Social |
| E-mail | `email` | `email` | como na v1 e no CRM (`email` + `email`); a lista/campanha vai em `utm_campaign`; GA4: Email; nunca ID de contato nem e-mail do destinatário |
| Parceiro | `parceiro_<empresa>` | `referral` | como na v1 |

## 9. Decisões pendentes do titular

- **U6:** `utm_source` da Meta (A, B ou C).
- **U7:** IDs permanentes em parâmetros próprios (`utm_id`, `adset_id`, `ad_id`) em vez de só dentro de `utm_content` (muda a regra 6 da v1).
- **U8:** aprovar a v2 e substituir a v1.
- **U9:** quando aplicar no anúncio. A Meta pode pedir nova revisão ao salvar a edição e exibe aviso se a edição reiniciar a fase de aprendizado;
  conferir esse aviso na interface antes de salvar, sem publicar nada sem o "sim" do titular.
