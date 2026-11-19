-- 0021 — Comunicações transacionais do SHARK SCALE: e-mail (Resend) e WhatsApp.
--
-- PREPARADA, NÃO APLICADA. Aditiva e reexecutável (IF NOT EXISTS). Requer a 0001.
-- Não altera, não remove e não faz backfill de nenhum registro existente.
-- Nada aqui liga envios: as chaves gerais ficam em lib/crm/comms/config.ts (desligadas por padrão).
--
-- 1) crm.comms_messages: uma linha por mensagem LÓGICA (confirmação, lembrete da manhã, lembrete de 1 h,
--    resposta automática do WhatsApp). dedupe_key é a idempotência: a mesma reunião nunca gera
--    duas vezes a mesma mensagem, mesmo com reenvio, retentativa ou dupla chamada do webhook.
-- 2) crm.comms_whatsapp_refs: referência PÚBLICA opaca e temporária que vai no texto do wa.me.
--    Não é o id da reunião nem do lead: é aleatória, não adivinhável e expira.
--
-- LGPD: nenhuma tabela aqui guarda o e-mail ou o telefone em claro. O destinatário fica
-- MASCARADO (ex.: "jo***@gmail.com", "+55 (31) 9****-**12") só para o histórico administrativo;
-- o endereço real é lido de crm.leads no momento do envio e não é copiado.
-- ON DELETE CASCADE: apagar a reunião apaga o histórico de comunicação dela.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.comms_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id      uuid NOT NULL REFERENCES crm.appointments (id) ON DELETE CASCADE,
    channel             text NOT NULL,
    kind                text NOT NULL,
    dedupe_key          text NOT NULL,
    recipient_masked    text,
    scheduled_for       timestamptz,
    sent_at             timestamptz,
    claimed_at          timestamptz,
    provider_message_id text,
    status              text NOT NULL DEFAULT 'pending',
    attempts            integer NOT NULL DEFAULT 0,
    last_error          text,
    provider_status_at  timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT comms_messages_dedupe_key_unique UNIQUE (dedupe_key),
    CONSTRAINT comms_messages_channel_check CHECK (channel IN ('email', 'whatsapp')),
    CONSTRAINT comms_messages_kind_check CHECK (kind IN (
        'confirmation', 'reminder_morning', 'reminder_1h', 'whatsapp_auto_reply')),
    -- 'pending'   = a gravar/enviar;      'scheduled' = aceita pelo provedor com horário futuro;
    -- 'sent'      = aceita pelo provedor; 'delivered' = confirmada pelo webhook (≠ aceita);
    -- 'failed'    = recusada ou devolvida; 'cancelled' = reunião cancelada/remarcada antes do envio;
    -- 'skipped'   = não enviada por regra (franquia, canal desligado, destinatário inválido).
    CONSTRAINT comms_messages_status_check CHECK (status IN (
        'pending', 'sending', 'scheduled', 'sent', 'delivered', 'failed', 'cancel_requested', 'cancelled', 'skipped', 'needs_review')),
    CONSTRAINT comms_messages_attempts_check CHECK (attempts >= 0 AND attempts <= 20),
    CONSTRAINT comms_messages_dedupe_len CHECK (char_length(dedupe_key) BETWEEN 8 AND 200),
    CONSTRAINT comms_messages_masked_len CHECK (recipient_masked IS NULL OR char_length(recipient_masked) <= 120),
    CONSTRAINT comms_messages_error_len CHECK (last_error IS NULL OR char_length(last_error) <= 400),
    CONSTRAINT comms_messages_provider_len CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 120)
);

CREATE INDEX IF NOT EXISTS comms_messages_appointment_idx
    ON crm.comms_messages (appointment_id, created_at DESC);

-- Varredura dos lembretes que não couberam no agendamento nativo do provedor.
CREATE INDEX IF NOT EXISTS comms_messages_due_idx
    ON crm.comms_messages (scheduled_for)
    WHERE status = 'pending' AND scheduled_for IS NOT NULL;

-- Consumo do mês (franquia gratuita do provedor), por canal.
CREATE INDEX IF NOT EXISTS comms_messages_reservations_idx
    ON crm.comms_messages (channel, claimed_at, scheduled_for)
    WHERE claimed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS comms_messages_usage_idx
    ON crm.comms_messages (channel, sent_at)
    WHERE sent_at IS NOT NULL;

-- Webhooks do provedor chegam pelo id da mensagem.
CREATE INDEX IF NOT EXISTS comms_messages_provider_idx
    ON crm.comms_messages (provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm.comms_whatsapp_refs (
    ref            text PRIMARY KEY,
    appointment_id uuid NOT NULL REFERENCES crm.appointments (id) ON DELETE CASCADE,
    expires_at     timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    matched_at     timestamptz,
    CONSTRAINT comms_whatsapp_refs_format CHECK (ref ~ '^[a-hjkmnp-z2-9]{10}$')
);

CREATE INDEX IF NOT EXISTS comms_whatsapp_refs_appointment_idx
    ON crm.comms_whatsapp_refs (appointment_id);

CREATE INDEX IF NOT EXISTS comms_whatsapp_refs_expiry_idx
    ON crm.comms_whatsapp_refs (expires_at);

COMMIT;
