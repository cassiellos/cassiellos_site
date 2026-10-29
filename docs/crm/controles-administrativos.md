# Mini CRM Cassiellos — Controles administrativos (Fase 3.4)

Ambiente: somente Preview da branch `feature/mini-crm-shark-scale`. Todas as ações exigem:
- sessão administrativa válida;
- origem `crm.cassiellos.com.br` (ou o alias Preview);
- confirmação explícita na tela (o servidor exige `confirmed: true`).

Cada ação grava uma atividade na linha do tempo do lead com:
- `performed_by = crm_admin`;
- data e hora;
- `sessionRef`: hash da sessão administrativa, que não permite reconstruir o cookie.

Nenhum registro é apagado.

## Cancelar reunião (ficha do lead → Reuniões)

- Disponível para reuniões `confirmed`/`pending` que ainda não terminaram.
- Ordem segura:
  1. Confere a reunião.
  2. Cancela no **Google primeiro**: `DELETE` do evento com `sendUpdates=all`, e o Google avisa o participante.
  3. Só então marca a reunião como `cancelled` e a reserva como `cancelled`, o que libera o horário.
- Resultados do Google:
  - 204 = cancelado;
  - 410 = já estava cancelado;
  - 404 = o evento não existe;
  - qualquer outra resposta, erro ou tempo esgotado = **não confirmado**.
- Quando o Google não confirma:
  - nada é liberado: a reunião continua ativa e o horário segue ocupado;
  - a ficha mostra "Cancelamento não confirmado pelo Google";
  - a ação pode ser repetida com segurança, porque o cancelamento no Google é idempotente.
- Cliques repetidos ou simultâneos não duplicam o cancelamento.
- Reuniões já encerradas não são canceladas: use "realizada" ou "não compareceu".

## Marcar como não compareceu

- Disponível a partir do horário de início da reunião confirmada.
- O status passa a `no_show` e o evento do Google **não** é alterado.
- A reserva continua ocupando aquele intervalo: nada é liberado antecipadamente.
- O contato pode agendar OUTRO horário segundo as regras existentes (no_show não conta como reunião ativa).

## Corrigir classificação (lead real ↔ lead de teste)

- Altera somente o lead e registra `from → to`, o motivo opcional e quem fez.
- Reuniões, contratos e eventos internos antigos **mantêm** a classificação original. Nada é recalculado nem enviado à Meta.
- Registros futuros (novas reuniões e contratos) herdam a nova classificação.

## Reservas em processamento (Agenda → Reservas em processamento)

- Lista reservas `processing` com mais de 15 minutos.
- **Conferir no Google** (somente leitura): consulta o evento que a reserva pode ter criado (id `c` + id da reserva).
- **Encerrar e liberar**:
  - só funciona se o Google confirmar que não há evento ativo;
  - a reserva passa a `failed` (`RECONCILED_NO_GOOGLE_EVENT`) e o horário é liberado.
- **Registrar reunião**:
  - só funciona se o Google confirmar evento ativo;
  - cria a reunião confirmada no CRM, sem evento de conversão retroativo.
- O servidor refaz a conferência no Google no momento da decisão. Se o estado mudou, nada é alterado.

## Permissões e limites conhecidos

- Existe uma única conta administrativa. O `sessionRef` diferencia sessões, mas não pessoas.
  Usuários nominais exigiriam um novo modelo de login.
- O Google envia o aviso de cancelamento ao participante (comportamento padrão de `sendUpdates=all`).
