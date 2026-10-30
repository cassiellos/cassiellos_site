-- 0010 — Web Push administrativo do SHARK SCALE (PWA) · Etapa 5
--
-- PREPARADA, NÃO APLICADA. Aplicar somente no Neon PREVIEW e somente com autorização específica.
-- Nunca aplicar em Production. Requer a 0001–0009. Substitui a antiga proposta 0010 do Telegram, que
-- nunca foi aplicada em nenhum banco real e foi descartada.
-- Transação única e reexecutável (IF NOT EXISTS / ON CONFLICT). Não altera nem apaga registros existentes.
--
-- 1) crm.push_settings: preferências (avisar leads / reuniões) e o modelo da mensagem do WhatsApp.
-- 2) crm.push_subscriptions: aparelhos autorizados pelo administrador (inscrição Push do navegador).
--    Guarda o endpoint e as chaves públicas da inscrição, nunca o token VAPID privado.
-- 3) crm.push_notifications: um evento lógico por fato (chave única de deduplicação):
--    lead_created:<lead>, meeting_confirmed:<reunião>, meeting_whatsapp_ready:<reunião>, test:<id>.
-- 4) crm.push_deliveries: fila persistente — uma entrega por notificação e aparelho, com tentativas e
--    estados técnicos: aceita pelo serviço de push ≠ exibida no aparelho (recibo) ≠ aberta (toque).
-- Nenhum dado pessoal de lead é copiado para estas tabelas: só referências (IDs) e códigos de erro.
-- ON DELETE CASCADE: se um cadastro ou reunião for eliminado, o histórico de avisos vai junto.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.push_settings (
    id                smallint PRIMARY KEY DEFAULT 1,
    notify_leads      boolean NOT NULL DEFAULT true,
    notify_meetings   boolean NOT NULL DEFAULT true,
    whatsapp_template text,
    last_test_at      timestamptz,
    updated_by        text,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_settings_singleton CHECK (id = 1),
    CONSTRAINT push_settings_template_len CHECK (whatsapp_template IS NULL OR char_length(whatsapp_template) BETWEEN 1 AND 600),
    CONSTRAINT push_settings_updated_by_len CHECK (updated_by IS NULL OR char_length(updated_by) <= 60)
);

INSERT INTO crm.push_settings (id, updated_by) VALUES (1, 'migration:0010') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm.push_subscriptions (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    endpoint         text NOT NULL,
    p256dh           text NOT NULL,
    auth             text NOT NULL,
    label            text NOT NULL,
    push_host        text NOT NULL,
    status           text NOT NULL DEFAULT 'active',
    created_by       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_accepted_at timestamptz,
    last_failure_at  timestamptz,
    failure_count    integer NOT NULL DEFAULT 0,
    revoked_at       timestamptz,
    expired_at       timestamptz,
    CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    CONSTRAINT push_subscriptions_status_check CHECK (status IN ('active', 'revoked', 'expired', 'rejected')),
    CONSTRAINT push_subscriptions_endpoint_https CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 1024),
    CONSTRAINT push_subscriptions_keys_len CHECK (char_length(p256dh) BETWEEN 80 AND 100 AND char_length(auth) BETWEEN 16 AND 32),
    CONSTRAINT push_subscriptions_label_len CHECK (char_length(label) BETWEEN 1 AND 80),
    CONSTRAINT push_subscriptions_host_len CHECK (char_length(push_host) <= 100),
    CONSTRAINT push_subscriptions_created_by_len CHECK (created_by IS NULL OR char_length(created_by) <= 60)
);

CREATE TABLE IF NOT EXISTS crm.push_notifications (
    id             uuid DEFAULT gen_random_uuid() NOT NULL,
    kind           text NOT NULL,
    dedupe_key     text NOT NULL,
    sequence       smallint NOT NULL DEFAULT 1,
    lead_id        uuid,
    appointment_id uuid,
    is_test        boolean NOT NULL DEFAULT true,
    cancel_reason  text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    opened_at      timestamptz,
    CONSTRAINT push_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT push_notifications_dedupe_key UNIQUE (dedupe_key),
    CONSTRAINT push_notifications_kind_check CHECK (
        (kind = 'lead_created' AND sequence = 1 AND lead_id IS NOT NULL) OR
        (kind = 'meeting_confirmed' AND sequence = 1 AND appointment_id IS NOT NULL) OR
        (kind = 'meeting_whatsapp_ready' AND sequence = 2 AND appointment_id IS NOT NULL) OR
        (kind = 'test' AND sequence = 1)),
    CONSTRAINT push_notifications_dedupe_len CHECK (char_length(dedupe_key) <= 120),
    CONSTRAINT push_notifications_cancel_len CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 60),
    CONSTRAINT push_notifications_lead_fk FOREIGN KEY (lead_id) REFERENCES crm.leads(id) ON DELETE CASCADE,
    CONSTRAINT push_notifications_appointment_fk FOREIGN KEY (appointment_id) REFERENCES crm.appointments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm.push_deliveries (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    status          text NOT NULL DEFAULT 'pending',
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz,
    accepted_at     timestamptz,
    displayed_at    timestamptz,
    clicked_at      timestamptz,
    http_status     integer,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT push_deliveries_unique UNIQUE (notification_id, subscription_id),
    CONSTRAINT push_deliveries_status_check
        CHECK (status IN ('pending', 'sending', 'retry', 'accepted', 'failed', 'gone', 'cancelled')),
    CONSTRAINT push_deliveries_error_len CHECK (last_error IS NULL OR char_length(last_error) <= 60),
    CONSTRAINT push_deliveries_notification_fk FOREIGN KEY (notification_id)
        REFERENCES crm.push_notifications(id) ON DELETE CASCADE,
    CONSTRAINT push_deliveries_subscription_fk FOREIGN KEY (subscription_id)
        REFERENCES crm.push_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_push_deliveries_due
    ON crm.push_deliveries (status, next_attempt_at) WHERE status IN ('pending', 'retry', 'sending');
CREATE INDEX IF NOT EXISTS idx_crm_push_notifications_created ON crm.push_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_push_notifications_appointment ON crm.push_notifications (appointment_id);

COMMIT;
