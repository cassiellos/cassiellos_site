# Fase 4 — Integração controlada, etapa 3: privacidade e rastreamento

Branch local `local/integration-3-privacy`, criada a partir de `5b93963` (CRM publicado no Preview: disponibilidade V2 +
agendamento sem convite). **Sem push, deploy ou migração.** Meta Pixel, CAPI, Telegram e Asaas não entram.

Commits de `local/privacy-split-prep` aplicados: `62601b1` (base), `3958546` (Vercel no CRM), `1deae34` (AnalyticsFlow no
CRM) e os documentos de UTM/grupos. **Não entram** os commits do site institucional e do n8n (`4930cce`, `f857a96`, `1e9968a`).

## 1. Consentimento de métricas (escopo do CRM: `/agendar`, `/crm`)

| Item | Comportamento |
|---|---|
| Registro | Cookie primário `cassiellos_consent` = `{v:1, analytics, at}`; 180 dias; `SameSite=Lax`; `Secure` em HTTPS. Só a escolha, sem dado pessoal |
| Sem escolha | Nada opcional é carregado: Vercel Web Analytics, Speed Insights, AnalyticsFlow e eventos do funil ficam desligados |
| Aviso | Só em `/agendar`, dentro do cartão, acima das perguntas (no fluxo: não cobre campos; visível ao carregar também no celular). "Recusar" e "Aceitar métricas" com o mesmo peso; links para as políticas |
| Recusa | O formulário e o agendamento funcionam normalmente |
| Revogação | "Preferências de cookies" no rodapé reabre o aviso. Ao recusar, `beforeSend` descarta qualquer envio pendente do script já carregado e nenhum evento novo sai |
| `/crm` (painel) | Segue o cookie gravado; sem escolha, métricas desligadas |
| Site institucional | **Inalterado** (alteração depende de autorização própria para a `main`) |

Arquivos: `lib/privacy/consent.ts`, `consent-client.ts`, `analytics-policy.ts`, `components/analytics-privacy.tsx`,
`components/privacy/consent-notice.tsx`, `components/site-interaction-tracker.tsx`.

## 2. Eventos do funil (`lib/crm/funnel-events.ts`, `funnel-client.ts`)

| Evento | Quando | Deduplicação (sessão da aba) |
|---|---|---|
| `booking_form_view` | Página carregada ou consentimento dado na página | 1 por formulário |
| `booking_form_start` | Primeira resposta | 1 por formulário |
| `booking_step_completed` | Pergunta concluída (`step` = nome do campo, nunca a resposta) | 1 por etapa |
| `booking_form_submit` | Envio do cadastro | 1 por chave de idempotência |
| `booking_lead_registered` | Servidor gravou o lead | 1 por lead (retentativa e reenvio não contam) |
| `booking_slot_selected` | Horário escolhido (só `days_ahead`, sem data/hora) | 1 por horário |
| `booking_meeting_confirmed` | **Somente** confirmação real do backend; `alreadyConfirmed` não conta | 1 por reunião |
| `booking_form_error` | Erro relevante (`stage` + código do servidor) | 1 por etapa + código |

- **Sem dados pessoais:** só propriedades da lista (`form`, `mode`, `step`, `step_index`, `stage`, `code`, `state`,
  `days_ahead`), com validação de formato (sem `@`, espaços ou sequências longas de dígitos). Nenhum id é enviado.
- **Teste × real:** `mode = test` no ambiente de testes (modo `test` ou allowlist ativa) e para e-mail de domínio de teste.
  O AnalyticsFlow só recebe `form_submit` (`booking:<slug>`) de lead **real**. O Preview segue separado da Production na Vercel.
- **Destinos (com consentimento):** Vercel Web Analytics (evento personalizado) e o evento local `cassiellos:funnel`.
- O rastreador genérico não conta mais cada pergunta do `/agendar` como `form_submit`.

## 3. UTMs

- Mesma estrutura (`form_submissions.answers.attribution`), mesmas chaves (utm_* + `fbclid`); **nenhum campo novo**.
- UTM com aparência de e-mail é descartado no navegador **e** no servidor; maiúsculas/minúsculas preservadas (U4).
- `gclid` não é coletado nem exigido. `fbclid` continua gravado como antes (decisão da Etapa 4).
- Ficha do lead: linha "Canal (padrão de UTMs)", derivada na leitura: `google/cpc`, `meta/paid_social`,
  `instagram|facebook/organic_social`, `parceiro_<empresa>/referral` (e demais do padrão). Fora do padrão, aparece como tal.

## 4. Textos corrigidos

- Revisão do agendamento: "O link do Google Meet é disponibilizado na confirmação do agendamento" e "não envia convite por e-mail".
- Cancelamento no CRM: "O cancelamento remove o evento do calendário da Cassiellos, mas não envia aviso automático ao participante".

## 5. Preparação da Etapa 4 (não ativada)

- **Um só consentimento:** acrescentar a categoria `marketing` ao mesmo `cassiellos_consent` (versão 2, nova escolha),
  em vez do objeto separado de `local/meta-pixel-prep`.
- O Pixel deve escutar `cassiellos:funnel` com consentimento de marketing, apenas `mode = live`:
  `booking_lead_registered` → Lead e `booking_meeting_confirmed` → Schedule, com o `event_id` do servidor.

## 6. Pendências

**Jurídicas (exigem sua revisão; nada foi alterado nas políticas):**
1. Política de Cookies (atualizada em 22/08/2026): descrever o consentimento de métricas, o cookie `cassiellos_consent`
   (180 dias), Vercel Web Analytics, Speed Insights, o sistema de métricas próprio (AnalyticsFlow/cassiellOS),
   como alterar ou revogar e a nova data de atualização (data real da publicação).
2. Política de Privacidade: incluir as métricas do agendamento (finalidade e base legal a definir) e a ausência de convite
   por e-mail (proposta N5, não publicada).
3. Identificação do controlador (razão social/CNPJ) e canal do encarregado: não constam; **não foram inventados**.
4. Texto do aviso de métricas: factual, mas precisa de aprovação.
5. Site institucional: métricas continuam sem consentimento (fora desta etapa).

**UX (registrada, não implementada):** botão "Cancelar reunião" também na seção **Agenda** do CRM (hoje só na ficha do lead → Reuniões).
