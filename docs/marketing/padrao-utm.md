# Padrão de UTMs da Cassiellos

**Versão 1 — aprovada em 30/10/2026** (decisões U1–U5). Documento local, não publicado.

> A higienização automática do site (descartar e-mail em UTM, remover identificadores de clique das análises)
> **não substitui** a configuração correta das campanhas. Ela é uma rede de segurança, não a regra.

**Escopo (U4):** vale para **campanhas novas**. As campanhas ativas serão auditadas antes de qualquer migração, para
evitar perda de atribuição ou mudanças inesperadas em relatórios. Nenhuma campanha existente será alterada sem autorização.

## 1. Regras gerais

1. **Minúsculas sempre**, sem acentos e sem espaços: `black_friday_2026`, não `Black Friday 2026`.
2. **Separadores:**
   - `_` (sublinhado) entre palavras;
   - `-` (hífen) dentro de datas (`2026-11`) e entre chave e valor de um ID (`cid-123`);
   - `__` (dois sublinhados) entre pares chave-valor em `utm_content` (seção 3).
   - Não usar `+`, `%20`, `/`, `?`, `&`, `#` ou `=` dentro do valor.
3. **Vocabulário fechado** para `utm_source` e `utm_medium` (seção 2). Valor fora da lista precisa de aprovação prévia.
4. **Tamanho:** até 100 caracteres por valor. O site corta em 200.
5. **Proibido em qualquer UTM:** e-mail, CPF, telefone/WhatsApp, nome ou sobrenome de pessoa física, endereço, data de
   nascimento, ID de assinante ou contato de ferramenta de e-mail ou CRM, token, ou qualquer dado que identifique uma pessoa.
6. **IDs numéricos** só em `utm_content`, **sempre com chave explícita** (`cid-`, `agid-`, `asid-`, `ad-`) e inseridos
   por parâmetro dinâmico da plataforma. Número digitado à mão ou sem chave é proibido (mesmo formato de CPF ou telefone).
7. **Origem pelo contexto real do link (U1):** vale onde o link foi colocado, não a plataforma em que o visitante estava.
   Um anúncio da Meta exibido no Instagram é `meta`/`paid_social`; um link na bio do Instagram é `instagram`/`organic_social`.
8. **Identificadores de clique** (`gclid`, `fbclid`, `msclkid`…) são inseridos pelas plataformas e **não** substituem UTMs.
9. **Eventos e deduplicação:** os UTMs não alteram a estrutura atual de eventos nem a deduplicação por `event_id`.

## 2. Vocabulário

| Contexto do link | `utm_source` | `utm_medium` |
|---|---|---|
| Google Ads (Pesquisa, Performance Max, Display, YouTube) | `google` | `cpc` (U2) |
| Anúncios da Meta (Facebook e Instagram pagos) | `meta` (U1) | `paid_social` (U2) |
| Publicação orgânica ou bio do Instagram | `instagram` (U1) | `organic_social` (U2) |
| Publicação orgânica ou página do Facebook | `facebook` (U1) | `organic_social` (U2) |
| Mensagem de WhatsApp | `whatsapp` | `messaging` |
| E-mail marketing | `email` | `email` |
| Link interno entre propriedades da Cassiellos | `site` | `referral` |
| Empresa parceira (U5) | `parceiro_<empresa>` | `referral` |

`<empresa>`: identificador institucional normalizado (minúsculas, sem acentos, `_` entre palavras), ex.:
`parceiro_clinica_exemplo`. Nunca nome de pessoa física, e-mail, telefone ou outro dado pessoal.

## 3. `utm_campaign`, `utm_content` e `utm_term` (U3 — ambos)

| Campo | Padrão |
|---|---|
| `utm_campaign` | **Nome legível e padronizado** `<objetivo>_<publico_ou_nicho>_<aaaa-mm>`, ex.: `diagnostico_odontologia_2026-11`. Sem IDs. |
| `utm_content` | **IDs com chaves explícitas**, unidos por `__`: Google `cid-<campanha>__agid-<grupo>__ad-<anúncio>`; Meta `cid-<campanha>__asid-<conjunto>__ad-<anúncio>`. Opcional, ao final: `__cr-<nome_do_criativo>` (ex.: `cr-video_depoimento_v2`). O ID do anúncio identifica cada criativo individualmente. |
| `utm_term` | Palavra-chave comprada (Google: `{keyword}`) ou segmentação. Nunca o termo digitado pela pessoa. |

Chaves: `cid` = campanha · `agid` = grupo de anúncios (Google) · `asid` = conjunto de anúncios (Meta) · `ad` = anúncio ·
`cr` = rótulo legível do criativo (opcional).

## 4. Modelos por plataforma

**Google Ads — "Sufixo do URL final"**, com a marcação automática (gclid) **também** ativa. O Google não tem parâmetro
dinâmico para o nome da campanha. Duas opções:
- definir o sufixo **no nível da campanha**, com o nome escrito; ou
- usar um parâmetro personalizado `{_campanha}` definido em cada campanha.

```
utm_source=google&utm_medium=cpc&utm_campaign={_campanha}&utm_content=cid-{campaignid}__agid-{adgroupid}__ad-{creative}&utm_term={keyword}
```

(Performance Max não tem grupo de anúncios: `agid-` fica vazio, o que é aceito.)

**Meta Ads — "Parâmetros de URL"** (nível do anúncio):

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content=cid-{{campaign.id}}__asid-{{adset.id}}__ad-{{ad.id}}
```

`{{campaign.name}}` só pode ser usado se o nome da campanha na Meta seguir a regra da seção 3. Caso contrário, escreva o
nome padronizado diretamente.

## 5. Exemplos

Corretos:

```
https://crm.cassiellos.com.br/agendar/odontologia?utm_source=meta&utm_medium=paid_social&utm_campaign=diagnostico_odontologia_2026-11&utm_content=cid-120211234567890123__asid-120211234567890234__ad-120211234567890456
https://cassiellos.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=diagnostico_odontologia_2026-11&utm_content=cid-22334455667__agid-145678901234__ad-678901234567&utm_term=agencia_marketing_odontologico
https://cassiellos.com.br/?utm_source=instagram&utm_medium=organic_social&utm_campaign=bio_institucional_2026-11
https://cassiellos.com.br/?utm_source=whatsapp&utm_medium=messaging&utm_campaign=reativacao_2026-11
https://cassiellos.com.br/?utm_source=parceiro_clinica_exemplo&utm_medium=referral&utm_campaign=indicacao_parceiros_2026-11
```

Incorretos (e por quê):

| URL | Problema |
|---|---|
| `?utm_source=Google Ads&utm_medium=CPC` | Maiúsculas, espaço, fora do vocabulário |
| `?utm_source=instagram&utm_medium=paid_social` (anúncio da Meta) | Anúncio pago deve usar `meta` (U1) |
| `?utm_source=meta&utm_medium=cpc` | Meta paga usa `paid_social` (U2) |
| `?utm_campaign=120211234567890123` | ID em `utm_campaign`: deve ser nome legível; o ID vai em `utm_content` com chave (U3) |
| `?utm_content=22334455667` | ID sem chave explícita (pode ser confundido com CPF/telefone) |
| `?utm_source=email&utm_content=maria@clinica.com.br` | **E-mail** (o site descarta o valor, mas a configuração está errada) |
| `?utm_campaign=31999990000` | Número digitado à mão: pode ser **telefone** |
| `?utm_term=12345678909` | Formato de **CPF** |
| `?utm_source=parceiro_ana_souza` | **Nome de pessoa** como parceiro (U5) |
| `?utm_source=email&utm_content={{contact.id}}` | **ID de contato** da ferramenta de e-mail (identifica a pessoa) |
| Google Ads só com gclid, sem sufixo de UTMs | Tráfego pago pode aparecer sem origem nas análises |

## 6. O que o site faz automaticamente (rede de segurança)

- Descarta o valor de UTM com aparência de e-mail (inclusive `%40`).
- Remove caracteres de controle e limita a 200 caracteres.
- Preserva os valores do padrão acima: `-`, `_`, `__` e IDs numéricos com chave.
- Nas análises de navegação (Vercel Analytics, AnalyticsFlow), não envia identificadores de clique, conforme os grupos
  de privacidade aprovados.
- **Não** detecta CPF, telefone ou nome em UTMs: isso depende deste padrão.

## 7. Registro de decisões

| Decisão | Conteúdo |
|---|---|
| U1 | Meta paga = `meta`; orgânico = `instagram`/`facebook`; origem pelo contexto real do link |
| U2 | Meta Ads = `paid_social`; Google Ads = `cpc`; orgânico = `organic_social` |
| U3 | `utm_campaign` legível; IDs (campanha, conjunto/grupo, anúncio) em `utm_content` com chaves explícitas; criativos identificáveis; sem dados pessoais; eventos e `event_id` inalterados |
| U4 | Só campanhas novas; campanhas ativas auditadas antes de qualquer migração; nada alterado agora |
| U5 | `utm_source=parceiro_<empresa>`, `utm_medium=referral`, identificador institucional normalizado |
