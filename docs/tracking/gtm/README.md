# Container GTM do formulário — rascunho

Arquivo: `cassiellos-formulario-gtm-RASCUNHO.json` (gerado a partir do contrato de eventos; **não foi importado nem
publicado**).

**Nome do container:** `Cassiellos | Formulário Hamburguerias | GTM` (tipo Web). Um único container por rota: ele
é carregado só em `/formularios/[slug]` (e nas jornadas do `/agendar` que usam o mesmo componente), nunca junto de
outro container concorrente.

## Inventário (51 itens)

| Tipo | Quantidade | Nome / padrão |
| --- | --- | --- |
| Pasta | 4 | `DLV \| Variáveis do dataLayer`, `TRG \| Gatilhos do funil`, `GA4 \| Eventos do funil`, `ADS \| Conversões (PAUSADAS até autorização)` |
| Variável | 9 | `DLV \| form_id`, `form_version`, `step_id`, `step_index`, `step_type`, `funnel_stage`, `flow_variant`, `validation_error_code`, `environment_mode` (dataLayer v2, sem valor padrão) |
| Gatilho | 19 | `TRG \| Evento \| <evento>` (evento personalizado igual ao nome do evento) |
| Tag GA4 | 20 | `GA4 \| Configuração \| Google tag` (1) + `GA4 \| Evento \| <evento>` (19), todas com consentimento `analytics_storage` obrigatório |
| Tag Ads | 3 | `ADS \| Conversion Linker`, `ADS \| Conversão \| Reunião confirmada`, `ADS \| Conversão \| Lead válido` — **pausadas**, IDs de modelo |

`CONSENT | Configuração` não é uma tag do GTM: o `consent default` (tudo negado) e os `update` saem do código do CRM
(`lib/privacy/consent-mode.ts` e `lib/tracking/gtm-runtime.ts`) **antes** do `gtm.js`. No GTM só existem as verificações
de consentimento por tag.

## Como importar (depois da autorização)

1. Criar o container novo com o nome acima (tipo Web).
2. Administrador → Importar container → escolher o arquivo → **espaço de trabalho novo** → "Mesclar" → "Substituir
   tags, gatilhos e variáveis conflitantes" só se o container estiver vazio.
3. Trocar `G-XXXXXXXXXX` pelo ID real do fluxo GA4 na tag de configuração e nas 19 tags de evento (ou criar uma
   variável de constante e apontar todas para ela).
4. Visão geral de consentimento → conferir que todas as tags GA4 pedem `analytics_storage`.
5. Pré-visualizar (GTM Preview) com o checklist da seção 10 de `../funil-formularios.md`. **Só então** publicar.

As tags `ADS | …` continuam pausadas até a decisão sobre conversão primária, o texto jurídico dos sinais `ad_*` e a
vinculação da conta do Google Ads.

## Limites desta validação

O arquivo é válido como JSON e foi checado por script (nomes únicos, todo gatilho e variável referenciado existe),
mas só o GTM confirma a importação. Se a importação acusar incompatibilidade, a causa mais provável é o formato de
alguma tag Google nova; nesse caso criar a tag manualmente seguindo o inventário.
