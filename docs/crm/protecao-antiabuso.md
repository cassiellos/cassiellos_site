# Mini CRM Cassiellos — Proteção antiabuso do agendamento (Fase 3 / item 4)

Ambiente: somente Preview da branch `feature/mini-crm-shark-scale` (crm.cassiellos.com.br).
A allowlist continua ativa e o Turnstile **não comprova a titularidade do e-mail**:
o sistema não está pronto para uso público só com estas proteções.

## Camadas, na ordem em que atuam

| Etapa | Proteção | Resposta pública |
|---|---|---|
| Cadastro (`POST /api/booking/leads`) | Validação dos campos e armadilha anti-robô (campo oculto) | `INVALID_*` |
| Cadastro | **Cloudflare Turnstile validado no servidor** (Siteverify: `success`, hostname `crm.cassiellos.com.br`, action `booking_lead`, token de no máximo 300 s e uso único). Nada é gravado antes. Falha fechada sem chaves ou com o serviço fora do ar. | `SECURITY_CHECK_REQUIRED` / `_FAILED` / `_EXPIRED` / `_UNAVAILABLE` |
| Cadastro | Limite por IP: 10 envios/hora (IP guardado só como HMAC) | `TOO_MANY_REQUESTS` |
| Cadastro | O envio é marcado `answers.protection.turnstile = "verified"`; a sessão de agendamento (HMAC, 2 h) só é emitida depois disso | — |
| Horários (`GET /api/booking/availability`) | Exige a sessão de agendamento (`X-Booking-Session`); limite por IP 50/15 min; contatos bloqueados param antes do Google | `BOOKING_SESSION_EXPIRED`, `CONTACT_HAS_ACTIVE_MEETING`, `BOOKING_LIMIT_REACHED` |
| Confirmação (`POST /api/booking/confirm`) | Pré-checagem somente leitura **antes do Google**: envio verificado, allowlist, envio já usado, reunião ativa, limite por e-mail | idem + `TEST_EMAIL_NOT_ALLOWED` |
| Confirmação | Trava por caixa de e-mail + índice único de horário + 2 consultas ao Google | `SLOT_UNAVAILABLE` |

## Regras por e-mail

- O e-mail é comparado numa forma canônica **por provedor** (revisada na Fase 3.4).
  O cadastro do lead e o endereço usado nos convites **não** mudam; a forma canônica serve apenas para as regras.
  Leads diferentes nunca são unificados.

  | Provedor (domínio) | Regra | Documentação oficial |
  |---|---|---|
  | Gmail (`gmail.com`, `googlemail.com`) | ignora `+sufixo` e pontos | support.google.com/mail/answer/7436150 · support.google.com/a/users/answer/9282734 |
  | Proton (`proton.me`, `protonmail.com`, `protonmail.ch`, `pm.me`) | ignora `+sufixo`, `.`, `_` e `-` | proton.me/support/addresses-and-aliases · proton.me/support/change-username |
  | Fastmail (`fastmail.com`) | ignora `+sufixo` | fastmail.help/hc/en-us/articles/360060591053 |
  | Todos os demais (Outlook, Hotmail, iCloud, Yahoo, corporativos, Google Workspace…) | só minúsculas e espaços | sem documentação oficial: tratados como caixas diferentes |

  Os domínios nunca são unificados entre si (por exemplo, `googlemail.com` ≠ `gmail.com`).
- **Uma reunião futura ativa por e-mail** (pending/confirmed até o término, ou reserva `processing` ainda não encerrada).
- **No máximo 3 agendamentos por e-mail em 30 dias** (reservas `processing`/`confirmed` criadas na janela; falhas antes do Google não contam).
- Mensagens públicas são genéricas: nunca mostram data, horário, link do Meet ou se o lead já existia.

## Contato legítimo bloqueado — como o administrador resolve

1. **"Já existe uma reunião para este contato"**: abra a ficha do lead (CRM → Leads). Se a reunião não vai acontecer,
   use **Cancelar reunião** (cancela no Google e libera o horário). Depois de iniciada sem o participante, use
   **Marcar como não compareceu**. Em ambos os casos o contato pode agendar de novo pelas regras normais.
   Veja `docs/crm/controles-administrativos.md`.
2. **Reserva presa em `processing`** (falha ambígua com o Google): CRM → Agenda → **Reservas em processamento** →
   **Conferir no Google**. Sem evento → **Encerrar e liberar**. Com evento ativo → **Registrar reunião**.
   Nada é apagado e o servidor confere o Google de novo antes de agir. O bloqueio também termina sozinho no fim do horário.
3. **"Não foi possível concluir o agendamento online"** (limite de 3 em 30 dias): o bloqueio expira 30 dias após cada
   agendamento. Para liberar antes, há duas opções:
   - agendar manualmente;
   - incluir o e-mail na variável `CRM_BOOKING_LIMIT_EXEMPT_EMAILS` (Vercel → Preview da branch, valores separados por
     vírgula) e fazer um novo deploy. A isenção vale **só** para o limite de 30 dias.
4. **Verificação de segurança falha para alguém**: peça para recarregar a página e desativar bloqueadores de anúncio no
   site. Persistindo, verifique os logs da Vercel (`[booking-leads] security_check_*`, apenas códigos) e o painel
   Turnstile da Cloudflare.
5. **Muitas tentativas (limite por IP)**: a liberação é automática após 1 hora (cadastro) ou 15 minutos (horários).

## Configuração

- Cloudflare → Turnstile → widget **Cassiellos Mini CRM - Agendamento**: modo Managed, hostname `crm.cassiellos.com.br`,
  sem pre-clearance, plano Free.
- Vercel → Preview, apenas a branch `feature/mini-crm-shark-scale`:
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (pública);
  - `TURNSTILE_SECRET_KEY` (Sensitive);
  - `CRM_BOOKING_LIMIT_EXEMPT_EMAILS` (opcional; hoje não configurada).
- Sem as duas chaves o formulário mostra "verificação de segurança indisponível" e não envia nada.
- Chaves oficiais de teste (`1x0000…`, `2x0000…`, `3x0000…`) são recusadas em qualquer deploy da Vercel. Elas são usadas
  apenas nos testes automatizados.
- Rotação: gere uma nova secret key no painel do widget, atualize `TURNSTILE_SECRET_KEY` na Vercel e faça um novo deploy.
