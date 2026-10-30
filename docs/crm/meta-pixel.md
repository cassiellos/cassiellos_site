# Mini CRM Cassiellos — Meta Pixel e preparação da Conversions API

Estado: código pronto e **desligado por padrão**. Nada é enviado à Meta enquanto
`META_PIXEL_ENABLED` não for `true` **e** `META_PIXEL_ID` não estiver configurado.
A Conversions API **não** está ativa (sem token, sem rotina de envio).

Situação em 29/10/2026:
- dataset criado (passo 1) e domínio verificado (passo 2) — ver "Ativação";
- **Pixel desligado**: nenhuma variável `META_PIXEL_*` configurada na Vercel, nenhum deploy com o Pixel;
- **Meta CAPI desativada**: sem token, sem envio, fila `crm.meta_deliveries` sem uso;
- passos 3 a 5 dependem de autorização própria.
- textos jurídicos v2 prontos **localmente** (decisões A–F de 29/10/2026), ainda **não publicados**:
  revisão das Políticas de Privacidade e de Cookies (pendente; páginas institucionais não alteradas nesta etapa).

Situação em 30/10/2026 (Etapa 4):
- Pixel ID confirmado no código-base do Gerenciador de Eventos: **28992534033707610** (igual ao ID do conjunto de dados);
- Meta: "Incluir automaticamente informações mais detalhadas de páginas e produtos" **desativado** (autorizado, P4);
  correspondência avançada, eventos automáticos e rastreamento sem código continuam desativados;
- aviso de marketing com o texto aprovado (P1) e políticas v3 aprovadas (D5) e publicadas no Preview com data efetiva
  30/10/2026 (`docs/legal/historico-politicas.md`); só depois disso o Pixel é ligado no Preview (`META_PIXEL_*`).
- Lead e Schedule comerciais reais: **homologação pendente**, antes da abertura pública. A allowlist mantém o modo de
  teste, que nunca envia Lead/Schedule; no Preview só o PageView (com consentimento de marketing) é validado.

## Arquitetura

| Peça | Onde | Regra |
|---|---|---|
| Consentimento | `lib/privacy/consent.ts` (Etapa 3, v2) | Um só cookie `cassiellos_consent` (180 dias) com categorias independentes `analytics` e `marketing`; `null` = não perguntado. Registros v1 (só métricas) continuam valendo e **não** autorizam marketing. Sem escolha = sem marketing. Recusar não afeta formulário nem agendamento |
| Aviso de cookies | `components/privacy/consent-notice.tsx` (o mesmo da Etapa 3) | Pixel desligado: aviso idêntico ao da Etapa 3. Pixel ligado: duas escolhas separadas (métricas e marketing), "Recusar" e "Aceitar" com o mesmo peso, nada pré-selecionado; reabre pelo rodapé "Preferências de cookies" |
| Pixel | `components/marketing/meta-pixel.tsx` (montado só na página `/agendar/[slug]`) | Só em `META_TRACKED_PATH_PREFIXES` (`/agendar/`). Nunca no CRM nem no site institucional. Script e `init` uma vez; `autoConfig` desligado; sem correspondência avançada; revogação → `consent revoke` + remoção de `_fbp/_fbc` |
| PageView | mesmo componente | Uma vez por carregamento da página do funil, só com consentimento de **marketing**; mudar a escolha não repete |
| Lead | servidor: `lib/crm/lead-intake.ts` → `crm.tracking_events` (`event_name = 'Lead'`, `event_id = lead_<id>`) | Um por lead (o primeiro envio válido). O navegador só recebe o `event_id` para lead **novo e real** |
| Schedule | servidor: `finalizeBookingReservation` → evento interno `Chronos_Scheduled` (`event_id = chronos_scheduled_<reserva>`) | Mapeado para `Schedule` (`lib/marketing/meta.ts`). O navegador só recebe o `event_id` **depois** da confirmação real no Google, e só para lead real |
| Envio no navegador | `lib/marketing/meta-client.ts` → `trackMetaConversion` | Exige Pixel carregado + consentimento; `eventID` do CRM; deduplicação na sessão; parâmetros só `content_name` (slug do formulário) |
| fbp / fbc | — | **Decisão C2: não vão ao CRM e não são gravados** enquanto a CAPI estiver desativada. O navegador envia só `{ consent, decided }` (`readMarketingConsent`); o servidor descarta qualquer outro campo (`sanitizeMarketingConsent`). O próprio Pixel continua usando seus cookies no navegador |
| Evidência LGPD | `crm.consents` (`purpose = marketing_measurement`) + `form_submissions.answers.marketing` | Autorização gravada com data e a versão das políticas em `lib/crm/policy-version.ts` (atualizar quando as políticas revisadas forem publicadas). A escolha (sim/não) de cada envio fica no envio |
| Revogação | `lib/crm/marketing-consent.ts` | Estado atual = registro mais recente. Revogar marca `revoked_at` nas autorizações ativas + novo registro `granted = false` + atividade na linha do tempo (quem/como). Nada é apagado e o cadastro, reuniões e contratos não mudam |
| Revogação pela página aberta | `POST /api/booking/consent` (`lib/crm/booking-consent-request.ts`) | Vínculo só pela sessão de agendamento assinada; registra recusa ou nova autorização feitas em "Preferências de cookies" depois do envio |
| Revogação por pedido ao canal | CRM → ficha do lead → "Medição de anúncios (Meta)" → "Registrar revogação (pedido do titular)" | Administrador só **revoga** (nunca autoriza pelo titular); auditoria com referência da sessão |
| Recusa em novo envio | `lib/crm/lead-intake.ts` | Recusa explícita em um novo envio do mesmo contato revoga a autorização anterior; envio sem escolha não muda nada |
| CAPI (preparo) | `lib/crm/meta-events.ts` → `buildMetaServerEvent(row, estadoAtual, idsDoMomento?)` | Mesmo `event_name` e `event_id` do Pixel. Só `isTest === false` e com consentimento **vigente no momento do envio** (`readMarketingConsentState`): revogado = nada sai. fbp/fbc só se forem passados no momento do envio (origem a definir quando a CAPI for autorizada). Sem e-mail ou telefone. A fila `crm.meta_deliveries` continua sem uso |
| Atribuição de campanha | `lib/crm/booking-intake-request.ts` (`ATTRIBUTION_KEYS`), `lib/crm/lead-intake.ts` (`attributionForStorage`) | `utm_*` gravados em todo envio (`answers.attribution`). **Decisão G2:** `fbclid` só é gravado com consentimento de marketing **validado no servidor** (`resolveMarketingConsent`: corpo + cookie `cassiellos_consent` da própria requisição); sem consentimento é descartado no navegador, no handler e na camada de gravação |
| fbclid na revogação | `removeStoredClickIds` em `lib/crm/marketing-consent.ts` | Recusa explícita ou revogação (página aberta, novo envio ou pedido ao canal) **apaga** o `fbclid` de todos os envios do lead (só essa chave; `utm_*` e respostas preservados). Atividade registra só a quantidade |
| fbclid na medição de navegação | `lib/privacy/analytics-policy.ts` (Etapa 3: chaves `*_CRM`) | No escopo do CRM (`/agendar`, `/crm`), o `fbclid` **nunca** é enviado à Vercel Analytics nem ao AnalyticsFlow. Site institucional inalterado |

## Ativação (cada passo exige autorização)

1. ✅ Dataset **"Cassiellos | CRM & Conversões"** criado em 29/10/2026. Dados:
   - ID **28992534033707610**;
   - pertence ao portfólio **Cassiellos (880054796119648)**;
   - vinculado só à conta de anúncios **Cassiellos 01 (368622509235308)**;
   - conexão automática à API de Conversões da Meta **desmarcada**;
   - sem categoria e sem integração Shopify;
   - nenhum evento recebido.
2. ✅ Domínio **cassiellos.com.br** verificado em 29/10/2026. Dados:
   - ID do domínio na Meta **1908921123810760**;
   - pertence ao portfólio **Cassiellos (880054796119648)**;
   - status **Verified**;
   - método: registro **TXT na Cloudflare** (zona cassiellos.com.br, nome `@`, TTL Auto),
     `facebook-domain-verification=xfzcc6yz2abjlftucob6izw2448ju3`;
   - o TXT deve ficar **permanentemente** no DNS (removê-lo pode desfazer a verificação);
   - nenhum parceiro atribuído e nenhum ativo conectado ao domínio.
3. Configurar `META_PIXEL_ID=28992534033707610` e `META_PIXEL_ENABLED=true` (Preview, branch) e fazer um novo deploy.
4. Validar com a ferramenta "Testar eventos" do Gerenciador de Eventos e com a extensão Meta Pixel Helper,
   usando apenas leads de teste. Leads de teste **não** disparam Lead nem Schedule; só aparecem PageViews.
5. CAPI (etapa futura):
   - token de usuário do sistema guardado só no servidor;
   - rotina de envio lendo `tracking_events` e `meta_deliveries`;
   - consultar `readMarketingConsentState` no momento de cada envio;
   - reavaliar origem, armazenamento, retenção e revogação de fbp/fbc (decisão C2) e atualizar as políticas **antes**;
   - `test_event_code` antes do envio real.

## Escopo e pendências registradas (29/10/2026)

- **Remarketing e públicos personalizados não fazem parte do escopo inicial.** Criar públicos (por exemplo,
  públicos de site no Gerenciador de Anúncios) exige **nova revisão** da finalidade, das políticas e do aviso
  de cookies antes de qualquer ativação.
- **Prazo de retenção dos registros de consentimento: depende de validação jurídica.** Nenhum prazo foi
  definido no texto ou no código.
- Páginas institucionais (fora de `/agendar/`), sem aviso de cookies: `utm_*`, `gclid` e `fbclid` continuam indo
  para o AnalyticsFlow (cassiellOS) e a URL completa para o Vercel Web Analytics — decisão pendente.
- `gclid` nas páginas do funil continua sendo enviado ao AnalyticsFlow (fora da decisão G) — decisão pendente.
- Registros antigos do Neon Preview gravados antes da G2 podem conter `fbclid` em `answers.attribution`
  (consulta somente leitura e eventual limpeza dependem de autorização).

## Antes de publicar (D3)

- Antes da abertura pública, resolver os bloqueios jurídicos: razão social, CNPJ, canal confirmado,
  encarregado ou enquadramento como pequeno porte confirmado, prazo de retenção dos consentimentos.
- `CRM_POLICY_VERSION` (`lib/crm/policy-version.ts`) = data **efetiva** da publicação das políticas revisadas (nunca futura).
- Revisão jurídica dos textos aprovada.

## Homologação de Lead e Schedule (somente Preview)

`lib/marketing/homologation.ts` + `POST/DELETE /api/crm/meta-homologation` + painel em CRM › Conversões.
Exige `META_HOMOLOGATION_PIXEL_ID` (dataset de homologação **diferente** do comercial). O administrador libera o
próprio navegador por até 30 min (cookie assinado `__Host-cassiellos_meta_homolog`, HttpOnly). Enquanto ativo, a
página `/agendar` carrega o Pixel de **homologação no lugar do comercial**; o backend devolve o `event_id` de
lead/reunião de **teste** e o navegador envia Lead/Schedule com a marca `cassiellos_teste=homologacao`, depois da
resposta real do backend e com consentimento de marketing. Fora do Preview, sem o dataset ou sem a liberação, o
comportamento é o de sempre (teste nunca vira conversão). Registro: log do servidor `meta_homologation` (referência
não reversível da sessão e horário).
