# Checklist de atribuição — Google Ads e Meta Ads

Para conferência manual nas contas (A5). **Nenhuma conta de anúncios foi alterada.** Marque e anote a evidência
(print ou link) de cada item. Referência: `docs/marketing/padrao-utm.md`.

## Google Ads

- [ ] **Marcação automática (gclid)** ativa em Configurações da conta. Mantê-la ligada.
- [ ] **Sufixo do URL final** nas campanhas novas: `utm_source=google&utm_medium=cpc&utm_campaign=<nome legível ou {_campanha}>&utm_content=cid-{campaignid}__agid-{adgroupid}__ad-{creative}&utm_term={keyword}` (padrão v1, U2/U3).
- [ ] O sufixo aparece no URL final testado (ferramenta "Testar" do anúncio) e chega ao site sem quebrar a página.
- [ ] Nenhuma campanha com **modelo de acompanhamento** ou sufixo **sobrescrevendo** o da conta com outro padrão.
- [ ] `utm_term={keyword}` usado só na Pesquisa (palavra-chave comprada, não o termo digitado).
- [ ] Nenhum valor fixo com nome de pessoa, e-mail, telefone ou CPF.

## Meta Ads

- [ ] **Parâmetros de URL** nos anúncios novos: `utm_source=meta&utm_medium=paid_social&utm_campaign=<nome legível ou {{campaign.name}}>&utm_content=cid-{{campaign.id}}__asid-{{adset.id}}__ad-{{ad.id}}` (padrão v1, U1–U3).
- [ ] Se usar `{{campaign.name}}`: o nome da campanha segue o padrão (minúsculas, `_`, sem dados pessoais).
- [ ] Anúncio pago exibido no Instagram usa `meta`/`paid_social`, não `instagram` (U1).
- [ ] Links com UTMs testados na pré-visualização: chegam ao site com os parâmetros.

## Padrões (todas as origens)

- [ ] `utm_source` dentro do vocabulário (`google`, `meta`, `instagram`, `facebook`, `whatsapp`, `email`, `site`, `parceiro_<empresa>`), definido pelo contexto real do link (U1).
- [ ] `utm_medium` dentro do vocabulário (`cpc`, `paid_social`, `display`, `video`, `organic_social`, `email`, `referral`, `messaging`).
- [ ] `utm_campaign` legível no padrão `<objetivo>_<publico>_<aaaa-mm>`, sem IDs (U3).
- [ ] `utm_content` com IDs **com chave** (`cid-`, `agid-`/`asid-`, `ad-`, opcional `cr-`), unidos por `__` (U3).
- [ ] `utm_term`: só palavra-chave comprada; nada que identifique pessoa.
- [ ] Parceiros: `utm_source=parceiro_<empresa>` + `utm_medium=referral`, sem nomes de pessoas (U5).
- [ ] Links de WhatsApp, e-mail e bio com UTMs próprios (sem reaproveitar links de anúncio).

## Campanhas ativas (U4)

- [ ] Listar as campanhas ativas e o padrão de UTMs que cada uma usa hoje (sem alterar nada).
- [ ] Identificar quais relatórios dependem dos valores atuais antes de propor qualquer migração.
- [ ] Migração das ativas somente com autorização, campanha por campanha.

## Risco de perda de atribuição

- [ ] Existe alguma campanha **só com gclid/fbclid** e sem UTMs? Se sim, o tráfego dela pode aparecer sem origem nas
      análises depois da minimização. Corrigir a configuração da campanha antes de publicar os grupos de privacidade.
- [ ] O cassiellOS (AnalyticsFlow) ou o n8n usam gclid/fbclid para algum relatório ou conversão offline?
      **Pendente: não verificado** (sem acesso ao cassiellOS; conector n8n indisponível nesta sessão).
- [ ] Tráfego sem UTM e com origem desconhecida **não** deve ser classificado automaticamente como orgânico (decisão A4).

## Dados pessoais

- [ ] Amostra das últimas 4 semanas de URLs de entrada (Vercel Analytics/AnalyticsFlow) sem e-mail, telefone, CPF ou
      nome em UTMs.
- [ ] Ferramentas de e-mail marketing não inserem ID de contato ou e-mail nos links (`{{contact.id}}`, `*|EMAIL|*` etc.).
