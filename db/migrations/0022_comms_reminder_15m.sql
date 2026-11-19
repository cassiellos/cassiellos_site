-- 0022 — Permitir o lembrete transacional 15 minutos antes da reunião.
-- Alteração de esquema isolada: não exclui dados, não altera agendamentos existentes,
-- não faz backfill nem envia mensagens. Reexecutável.
-- Aplicar em Production antes de publicar o código que enfileira reminder_15m.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- O CHECK criado na 0021 usa uma lista fixa de tipos; precisamos ampliá-la.
-- O ALTER e a validação estão na mesma transação, com rollback em caso de erro.
ALTER TABLE crm.comms_messages
  DROP CONSTRAINT IF EXISTS comms_messages_kind_check;

ALTER TABLE crm.comms_messages
  ADD CONSTRAINT comms_messages_kind_check
  CHECK (kind IN (
    'confirmation', 'reminder_morning', 'reminder_1h', 'reminder_15m', 'whatsapp_auto_reply'
  )) NOT VALID;

ALTER TABLE crm.comms_messages
  VALIDATE CONSTRAINT comms_messages_kind_check;
COMMIT;
