# Fase 4 — Integração controlada, etapa 2: agendamento sem convite

Branch local `local/integration-2-no-invite`, criada a partir de `95d4e2d`: a versão publicada no Preview, com a
disponibilidade V2 e a migração 0009 aplicada. Recebe um merge sem squash de `local/booking-no-invite-prep` @ `5ee4c6e`,
e o histórico original foi preservado. **Sem push, deploy ou migração.** Não inclui a privacidade do funil nem o Meta Pixel.

## O que entra

| Funcionalidade | Onde | Teste |
|---|---|---|
| Evento no Google sem convidados (`sendUpdates=none`, `guestsCanInviteOthers: false`), sem nome, e-mail ou telefone; só uma referência interna | `lib/crm/booking-event.ts`, `google-calendar.ts` | booking-event.test, booking-no-invite.db.test |
| Google Meet mantido (`conferenceData`); só links `https://meet.google.com/...` são gravados e exibidos | `booking-event.ts`, `booking-confirmation.ts` | idem |
| Tela de confirmação com o link, **Copiar link**, **Abrir Google Meet**, **Adicionar ao Google Agenda** e **Baixar .ics** (`METHOD:PUBLISH`, sem organizador e sem participantes) | `booking-experience.tsx`, `lib/crm/calendar-links.ts` | calendar-links.test, navegador local |
| Link pendente (N3): tela própria "Seu horário foi reservado!", sem nenhum link inexistente | `booking-experience.tsx` | navegador local |
| Idempotência: repetir a confirmação na mesma sessão devolve a mesma reunião e o mesmo link, sem novo evento | `booking-confirmation.ts` | booking-no-invite.db.test |
| Cancelamento pelo CRM remove o evento, cancela reunião e reserva e libera o horário | `admin-actions.ts` (inalterado) | booking-no-invite.db.test |
| Turnstile, allowlist, reunião ativa por caixa de e-mail e limite de 3 em 30 dias | inalterados | booking-antiabuse.db.test, booking-no-invite.db.test |

## Conflitos e decisões da integração

- **Sem conflito textual.** `booking-confirmation.ts` e `booking-experience.tsx` foram mesclados automaticamente e revisados um a um:
  - a barreira da disponibilidade V2 (409 antes de qualquer consulta ao banco ou ao Google) continua sendo o **primeiro** passo;
  - o calendário do servidor e a mensagem "Sem horários disponíveis" foram preservados.
- **Regras V2 preservadas:** 2 h de antecedência, inícios das 09h00 às 18h00 (término 18h30), janela de 3 dias, feriados, bloqueios e capacidade diária (desligada). A 0009 não foi alterada e não há migração nova.
- **`docs/crm/calendario-registro-2026.md` não entrou:** o conteúdo já foi incorporado a `docs/crm/disponibilidade.md` (N6), e a pendência que ele registrava foi resolvida em P5. Mantê-lo misturaria informação antiga de disponibilidade. O arquivo continua no histórico de `5ee4c6e`.
- **Testes do sem convite adaptados às regras atuais:** usam as regras V2, com a janela ampliada **só no teste**. Com 3 dias corridos, o fim de semana seguido de Finados (31/10–02/11) deixaria o teste sem nenhum horário. A confirmação recebe as mesmas regras (`loadRules`).
- **Testes novos da combinação:**
  - reunião das 18h00 (fim às 18h30) criada sem convidado;
  - 18h30 e feriado recusados antes do banco e do Google;
  - Google Agenda e `.ics` com o horário UTC correto (21:00–21:30Z);
  - repetição depois do limite de antecedência (ver abaixo).

## Comportamento conhecido (para decisão)

Se a resposta da confirmação se perder (rede) **e** o visitante repetir depois que o horário reservado passou do limite de 2 h:

- a barreira V2 responde `409 SLOT_UNAVAILABLE` ("Esse horário acabou de ficar indisponível") antes de consultar o banco (decisão D-D);
- **nenhuma reunião é duplicada**;
- ao escolher outro horário, o servidor devolve a **mesma** reunião, com o horário real e o link.

O caso só acontece com o primeiro horário disponível do dia e uma nova tentativa minutos depois.

Alternativa possível, que **não** foi implementada por mudar a decisão D-D: na recusa, fazer uma consulta somente leitura da reunião já confirmada daquela sessão assinada e devolvê-la.

## Pendências antes de publicar no Preview

1. Autorização de push e deploy de `local/integration-2-no-invite`, somente na feature, a partir de uma sessão com permissão de escrita.
2. Nenhuma migração é necessária.
3. Depois do deploy, fazer uma validação somente leitura e, com autorização, um teste real controlado pelo e-mail da allowlist:
   - conferir que o evento não tem convidado e que o Meet foi criado;
   - verificar copiar link, Agenda e `.ics`;
   - cancelar pelo CRM.
4. N1: antes da abertura pública, testar a entrada no Meet com uma conta Google externa (pode exigir admissão manual).
5. N5: a proposta de Política de Privacidade (`docs/crm/politica-privacidade-proposta-sem-convite.md`) **não está publicada** e exige revisão.
6. A allowlist continua ativa (N7). A liberação para qualquer e-mail depende de autorização própria.
