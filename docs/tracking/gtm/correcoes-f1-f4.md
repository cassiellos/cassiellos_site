# Correções F1–F4 do rastreamento — o que muda no código e o que o GTM precisa refletir

Estado: **só código e rascunho de texto**. Nada foi publicado no GTM, nada foi implantado, nenhuma UTM do anúncio ativo foi tocada.
Escopo: exclusivamente `https://crm.cassiellos.com.br/formularios/hamburguerias` (URL, perguntas, copy e agendamento inalterados).

## F1 — parâmetros residuais (`lib/tracking/funnel-contract.ts`, `datalayer-client.ts`)

O dataLayer do GTM **mescla** cada `push`. Antes, o que um evento não repetia continuava valendo no seguinte (um `validation_error_code` de
pergunta aparecia no `generate_lead`; `step_id` de pergunta aparecia nos eventos do calendário).

Agora **todo** `push` traz `event` + os parâmetros pertinentes + `undefined` explícito em cada parâmetro opcional ausente. No modelo do GTM,
`undefined` apaga o valor herdado e a tag do GA4 omite o parâmetro.

Opcionais reinicializados a cada evento (`OPTIONAL_TRACKING_PARAM_KEYS`): `form_version`, `step_id`, `step_index`, `step_order`, `step_type`,
`funnel_stage`, `flow_variant`, `validation_error_code`. Obrigatórios em todo evento: `form_id`, `environment_mode`.

**GTM (conferir no espaço de trabalho; sem publicar):**
- As 10 variáveis `DLV | …` devem ser **Variável da camada de dados, versão 2, SEM valor padrão** (`setDefaultValue=false`, como no rascunho do repositório).
  Um valor padrão em qualquer uma delas esconderia a correção e reintroduziria o resíduo.
- No Tag Assistant (Preview), na aba "Data Layer" de cada evento, as chaves ausentes aparecem como `undefined` e **não** devem aparecer na aba "Variables" com valor.
- Verificações de comportamento: `form_validation_error` (com `validation_error_code`) seguido de `lead_submit_attempt` e `generate_lead` → os dois últimos sem
  `validation_error_code`; qualquer `booking_*` sem `step_id`, `step_index` nem `step_order` (só `step_type=calendar`).

## F2 — escopo exclusivo (`TRACKING_SCOPE_PATHS`, `isTrackingScopeForm`, `getGtmFormConfigForSlug`)

Correspondência **exata** da rota `/formularios/hamburguerias` (slug canônico do formulário publicado; sem decodificar, sem caixa, sem prefixo/sufixo).
`hamburguerias-2`, `hamburgueria`, `Hamburguerias`, `hamburguerias/x`, `odontologia` etc. ficam de fora:
- a página só entrega o `containerId` do GTM ao componente quando o slug é exatamente o do escopo (senão o GTM nem é renderizado);
- o emissor do dataLayer descarta qualquer evento cujo `form_id` não seja o do escopo (inclusive a ponte do `/agendar`).

**GTM (defesa em profundidade, nos gatilhos):** em **todos** os gatilhos de evento e no da tag Google, acrescentar a condição
`Page Path` **é igual a** `/formularios/hamburguerias` (operador "é igual a", **não** "contém" nem regex). Ampliar o escopo exige mudar
`TRACKING_SCOPE_PATHS` no código (revisão) e nova autorização.

## F3 — lead novo × recadastro × repetição (`lib/tracking/lead-outcome.ts`, rota `POST /api/public/forms/[slug]`)

O servidor passa a devolver `leadOutcome` (a resposta anterior continua igual; o campo é novo):

| `leadOutcome` | Situação | `generate_lead` |
| --- | --- | --- |
| `new` | linha nova em `crm.leads` (real ou de teste; o modo vem em `leadMode`) | sim, uma vez |
| `resubmitted` | e-mail já existente (recadastro em outra visita): nova submissão, nenhum lead novo | não |
| `reused` | mesma chave de idempotência (repetição do mesmo envio) | não |

Lead de teste é lead novo com `leadMode=test` (`environment_mode=test`, vai só à propriedade de homologação). Resposta sem `leadOutcome` válido nunca
gera o evento. **Inalterados:** status HTTP, `reused`, regra do evento `Lead`/CAPI da Meta, `event_id`, chave de deduplicação do navegador, qualificação, agendamento.
Nenhuma mudança no GTM; no DebugView, o **segundo** cadastro com o mesmo e-mail **não** deve produzir `generate_lead`.

## F4 — privacidade das UTMs (`lib/privacy/url-sanitize.ts` ⇄ `page-location-sanitizado.js`, `atribuicao-parametro.js`)

Texto de `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e `utm_term` (e `placement`) é descartado quando tem formato de dado pessoal:
`@`/e-mail (inclusive `%40`), telefone (com/sem DDD e `+55`, com separadores), CPF, CNPJ, CEP formatado, qualquer sequência de **9 a 14 dígitos** sem chave
de ID, endereço IP, URL (`http:`, `www.`, `://`, `//`) e código opaco longo (32+ caracteres alfanuméricos com letra e dígito).
Preservados: nomes legíveis de campanha, IDs **com chave explícita** (`cid-…`, `agid-…`, `asid-…`, `adid-…`, `ad-…`, `adset-…`, `cmp-…`) e IDs de plataforma de
15–20 dígitos. `utm_id`, `adset_id`, `ad_id`: só 15–20 dígitos ou `chave-número` (a chave precisa estar na lista acima: `tel-…`, `cpf-…` não passam).
`utm_source` e `utm_medium`: **uma palavra** (letras, dígitos, `_`, `.`, `-`; até 40) — nome com espaço não passa; há lista de valores conhecidos
(`KNOWN_UTM_SOURCES`, `KNOWN_UTM_MEDIUMS`), que o par do anúncio v2 (`meta` + `paid_social`) integra.

**Mudança de comportamento (decisão a registrar):** um número "puro" de 9 a 14 dígitos em `utm_campaign`/`utm_content`/`utm_term` (por exemplo o `{campaignid}` numérico
do Google Ads sem chave) deixa de ser aceito, porque é indistinguível de telefone/CPF/CNPJ. O padrão v1 (regra 6) já exige chave explícita para IDs em `utm_content`.
Não há campanha no Google Ads e o anúncio ativo da Meta não tem UTMs: nada é afetado hoje.

**Limite que nenhuma expressão regular resolve:** nome próprio ou outro texto livre inserido em `utm_campaign`, `utm_content` ou `utm_term` (ex.: "Maria Silva")
passa, porque é indistinguível de um nome de campanha. Mitigações: origem/meio aceitam só uma palavra; todo parâmetro fora da lista é removido; os links dos
anúncios são montados pela agência; e a ocultação de parâmetros de URL do GA4 (seção 6.2 de `docs/marketing/padrao-utm-v2.md`) segue como reforço.

**Variáveis do GTM a atualizar (colar o texto inteiro, sem alterar; `ALLOW_GOOGLE_CLICK_IDS` continua `false`):**
1. `JS | page_location sanitizado` ← `docs/tracking/gtm/page-location-sanitizado.js`
2. `JS | atribuição adset_id`, `JS | atribuição ad_id`, `JS | atribuição placement` ← `docs/tracking/gtm/atribuicao-parametro.js` (mudar só a linha `var KEY = …`)
3. `JS | page_referrer sanitizado` ← `docs/tracking/gtm/page-referrer-sanitizado.js` (inalterada)

O teste `lib/privacy/f4-privacidade-utm.test.ts` executa o **texto exato** dessas variáveis contra a função do site em mais de 800 combinações (chave × valor) e exige resultado idêntico.
