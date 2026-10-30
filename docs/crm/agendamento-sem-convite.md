# Agendamento público sem convite automático

Status: **implementado localmente** (branch `local/booking-no-invite-prep`, base `dae52f7`). Nada foi publicado.
**A allowlist continua ativa** (`CRM_BOOKING_ALLOWED_EMAIL`): a liberação para qualquer e-mail depende de autorização.

## 1. Auditoria (base `dae52f7`)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Onde o convidado era adicionado | `lib/crm/google-calendar.ts` → `createGoogleBooking`: `attendees: [{ email: input.guestEmail }]` com `sendUpdates=all`. O e-mail vinha de `lib/crm/booking-confirmation.ts` (`guestEmail: reservation.email`, o e-mail do lead no CRM). O Google enviava convite ao endereço digitado. |
| 2 | Como o Meet é criado | `conferenceData.createRequest` com `conferenceSolutionKey: hangoutsMeet`, `requestId` = id da reserva e `conferenceDataVersion=1`. O link vem de `hangoutLink`. |
| 3 | Como a confirmação era exibida | `app/agendar/[slug]/booking-experience.tsx`, etapa 4: só o botão "Abrir Google Meet" (sem copiar e sem adicionar à agenda). A resposta também trazia `googleCalendarUrl` (`htmlLink`), um link da agenda interna da Cassiellos que não servia ao visitante e identifica a agenda. |
| 4 | Como os e-mails ficam no CRM | `crm.leads.email` (normalizado em minúsculas, `lib/crm/lead-intake.ts`). A reserva (`crm.booking_requests`) não guarda e-mail: ele é lido do lead. Regras por caixa canônica em `booking-reservation.ts`. |
| 5 | O que depende da allowlist | `app/agendar/[slug]/page.tsx` e `app/api/booking/confirm/route.ts` (o agendamento só fica ativo com `CRM_BOOKING_ALLOWED_EMAIL` definido); `checkBookingEligibility` (`TEST_EMAIL_NOT_ALLOWED`); `booking-mode.ts` (o e-mail da allowlist é sempre classificado como teste). A consulta de horários ignora a allowlist (`skipAllowlist`). `CRM_BOOKING_LIMIT_EXEMPT_EMAILS` é independente (isenção de limite). |

Outros pontos da auditoria:
- O link do Meet só existe em `crm.appointments.meeting_url` (painel administrativo) e na resposta da confirmação.
- Não aparece em logs: as rotas de agendamento não registram nada além do motivo genérico do Turnstile.
- As análises (`SiteInteractionTracker` e Vercel Analytics) registram de links externos **apenas o domínio**
  (ex.: `meet.google.com`), nunca o código da reunião. A URL da página não muda na confirmação.

## 2. Alteração de comportamento

| Antes | Depois |
|---|---|
| Evento com o e-mail do visitante como convidado; Google enviava convite (`sendUpdates=all`) | Evento **sem convidados**, `sendUpdates=none`, `guestsCanInviteOthers: false`. Nenhum e-mail é enviado pelo Google na criação. |
| Descrição genérica | Descrição sem dados pessoais + **referência interna** (8 primeiros caracteres da reserva) para localizar o lead no CRM |
| Link do Meet aceito como veio | Só links `https://meet.google.com/...` são gravados e exibidos |
| Confirmação: botão "Abrir Google Meet" | Confirmação com o link visível, **Copiar link**, **Abrir Google Meet**, **Adicionar ao Google Agenda** (modelo na agenda do próprio visitante) e **Baixar .ics** (Apple/Outlook; `METHOD:PUBLISH`, sem organizador e sem participantes). Aviso: "Não enviamos convite automático por e-mail." |
| Repetir a confirmação devolvia só `alreadyConfirmed` | Devolve a reunião registrada (horário real e link do Meet) **somente** ao titular da sessão assinada daquela inscrição, sem novo evento e sem consulta ao Google |
| Resposta com `googleCalendarUrl` | Removido; a resposta passa a ter `invitationSent: false` e `meetingTitle` |

Mantidos sem alteração: Turnstile, sessão de agendamento assinada, allowlist, uma reunião futura ativa por caixa
de e-mail, limite de 3 em 30 dias, trava e índice único contra duplicidade, nova checagem no Google antes de criar,
revisão manual em falha ambígua (sem nova tentativa) e cancelamento pelo CRM.

## 3. Impacto operacional

1. **Entrada na reunião:** como o visitante não é convidado, ao abrir o link ele pode precisar **pedir para participar**.
   O organizador (conta da agenda da Cassiellos) precisa estar na sala para admitir. Isso vale sobretudo para participantes
   fora da organização.
2. **Lembretes:** o Google não envia lembrete ao visitante. Os lembretes são os da agenda dele, se ele usar os botões de
   adicionar. O `.ics` inclui alerta 30 min antes.
3. **Cancelamento e remarcação:** o cancelamento pelo CRM remove o evento no Google, mas **o visitante não recebe aviso
   automático** (não há convidado). A equipe deve avisá-lo por canal próprio. As 4 reuniões antigas, que têm convidado,
   continuam avisando o convidado no cancelamento (`sendUpdates=all` mantido no cancelamento).
4. **Meet pendente:** se o Google não devolver o link na hora, a tela informa que a equipe entrará em contato.
   A equipe vê o evento e o link no Google/CRM (busca pela referência).
5. **Localizar o lead pelo evento:** use a referência da descrição (prefixo do id da reserva no CRM).
6. **Perda do link:** se o visitante fechar a página sem salvar, o link não chega por e-mail. Mitigações atuais:
   botões de agenda e, se a resposta se perder (rede), nova tentativa na mesma página devolve o mesmo link (sessão válida por até 2 h), sem criar outro evento. Futuro: envio por WhatsApp com consentimento (não implementado).

## 4. Impacto na Política de Privacidade (para revisão; documentos publicados NÃO alterados)

- O e-mail do visitante **deixa de ser compartilhado com o Google Calendar** como convidado. Ele continua armazenado no
  CRM para contato e para as regras de agendamento.
- O Google continua processando os dados do evento (data, horário, título genérico, referência interna e Meet) na conta
  da Cassiellos. Nenhum nome, e-mail ou telefone vai para o evento.
- "Adicionar ao Google Agenda" e o `.ics` acontecem por ação do próprio visitante, no navegador dele. A Cassiellos não
  recebe nem envia nada nessa etapa.
- Trecho sugerido para revisão jurídica, a ser publicado só após a sua aprovação:
  > "Ao agendar uma reunião, criamos o compromisso na agenda da Cassiellos com link do Google Meet, sem incluir seu
  > e-mail como convidado. O link é exibido na tela de confirmação para que você o salve na sua agenda."

## 5. Liberação futura para qualquer e-mail (não feita)

Requer autorização e:
- remover ou condicionar a exigência de `CRM_BOOKING_ALLOWED_EMAIL` na página e na rota de confirmação;
- revisar `TEST_EMAIL_NOT_ALLOWED` e a classificação teste/real (`CRM_BOOKING_MODE`);
- publicar a política revisada;
- testar o fluxo real controlado.
