-- 0016 — Fundação da integração Asaas no Financeiro (somente ADITIVA). FASE 1: PREPARADA, NÃO APLICADA.
--
-- Não aplicar no Neon Preview nem em Production sem autorização própria. Requer 0011 e 0015.
-- Transação única; reexecutável (IF NOT EXISTS / constraints condicionais); não altera nenhum dado existente:
-- contratos existentes ficam com billing_provider = 'manual' (comportamento atual).
--
-- Modelo (CRM = contratos, competências e histórico; Asaas = processamento de pagamentos):
--   finance_sources.billing_provider   quem cobra: manual | asaas_subscription (assinatura externa, gerida no Asaas)
--                                       | asaas_charge (cobranças avulsas criadas futuramente pelo CRM)
--   finance_asaas_customers             cliente CRM <-> cliente Asaas, por ambiente
--   finance_asaas_subscriptions         contrato CRM <-> assinatura Asaas, por ambiente (vínculo, nunca recriação)
--   finance_asaas_payments              cada cobrança do Asaas (bruto, líquido, tarifa, datas, situação) e seu vínculo
--                                       com o lançamento da competência
--   finance_asaas_payment_settlements   cobrança Asaas <-> movimentos do Financeiro (1:N — parciais/estornos preservados)
--   finance_asaas_events                eventos de webhook (deduplicação, tentativas, erros), sem dados pessoais
--   finance_integration_log             trilha da integração (vínculos, conciliações, divergências)
-- Toda unicidade inclui o AMBIENTE (sandbox/production): o mesmo id externo pode existir nos dois.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── Provedor de cobrança do contrato ───────────────────────────────────────────────────────────────
ALTER TABLE crm.finance_sources ADD COLUMN IF NOT EXISTS billing_provider text NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_sources_billing_provider'
                   AND conrelid = 'crm.finance_sources'::regclass) THEN
    ALTER TABLE crm.finance_sources ADD CONSTRAINT finance_sources_billing_provider CHECK (
      billing_provider IN ('manual', 'asaas_subscription', 'asaas_charge')
      AND (billing_provider = 'manual' OR direction = 'in'));
  END IF;
END $$;

-- ── Clientes ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.finance_asaas_customers (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    environment       text NOT NULL,
    client_id         uuid NOT NULL REFERENCES crm.finance_clients (id),
    asaas_customer_id text NOT NULL,
    status            text NOT NULL DEFAULT 'active',
    created_by        text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    unlinked_at       timestamptz,
    CONSTRAINT finance_asaas_customers_env CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT finance_asaas_customers_status CHECK (status IN ('active', 'unlinked')),
    CONSTRAINT finance_asaas_customers_unlinked CHECK ((status = 'unlinked') = (unlinked_at IS NOT NULL)),
    CONSTRAINT finance_asaas_customers_ref CHECK (asaas_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$')
);
-- Um cliente Asaas ativo por cliente CRM, e vice-versa, em cada ambiente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_customers_external
    ON crm.finance_asaas_customers (environment, asaas_customer_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_customers_client
    ON crm.finance_asaas_customers (environment, client_id) WHERE status = 'active';

-- ── Assinaturas ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.finance_asaas_subscriptions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    environment           text NOT NULL,
    source_id             uuid NOT NULL REFERENCES crm.finance_sources (id),
    customer_link_id      uuid REFERENCES crm.finance_asaas_customers (id),
    asaas_subscription_id text NOT NULL,
    value_cents           bigint NOT NULL,
    cycle                 text NOT NULL,
    next_due_date         date,
    external_status       text,
    status                text NOT NULL DEFAULT 'active',
    divergent             boolean NOT NULL DEFAULT false,
    divergence_codes      text[] NOT NULL DEFAULT '{}',
    created_by            text NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    last_synced_at        timestamptz,
    unlinked_at           timestamptz,
    CONSTRAINT finance_asaas_subscriptions_env CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT finance_asaas_subscriptions_status CHECK (status IN ('active', 'unlinked')),
    CONSTRAINT finance_asaas_subscriptions_unlinked CHECK ((status = 'unlinked') = (unlinked_at IS NOT NULL)),
    CONSTRAINT finance_asaas_subscriptions_ref CHECK (asaas_subscription_id ~ '^sub_[A-Za-z0-9]{1,64}$'),
    CONSTRAINT finance_asaas_subscriptions_value CHECK (value_cents > 0 AND value_cents <= 100000000000),
    CONSTRAINT finance_asaas_subscriptions_cycle CHECK (cycle IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY')),
    CONSTRAINT finance_asaas_subscriptions_divergence CHECK (divergent = (cardinality(divergence_codes) > 0))
);
-- Uma assinatura externa ativa liga a UM contrato; um contrato tem no máximo UMA assinatura ativa (por ambiente).
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_subscriptions_external
    ON crm.finance_asaas_subscriptions (environment, asaas_subscription_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_subscriptions_source
    ON crm.finance_asaas_subscriptions (environment, source_id) WHERE status = 'active';

-- ── Cobranças ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.finance_asaas_payments (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    environment               text NOT NULL,
    asaas_payment_id          text NOT NULL,
    asaas_subscription_id     text,
    subscription_link_id      uuid REFERENCES crm.finance_asaas_subscriptions (id),
    entry_id                  uuid REFERENCES crm.finance_entries (id),
    competence_month          date,
    link_status               text NOT NULL DEFAULT 'unmatched',
    is_additional             boolean NOT NULL DEFAULT false,
    additional_justification  text,
    manual_overlap_confirmed  boolean NOT NULL DEFAULT false,
    divergence_accepted       boolean NOT NULL DEFAULT false,
    divergence_justification  text,
    external_status           text NOT NULL,
    normalized_state          text NOT NULL,
    deleted                   boolean NOT NULL DEFAULT false,
    billing_type              text,
    value_cents               bigint NOT NULL,
    net_value_cents           bigint,
    fee_cents                 bigint GENERATED ALWAYS AS (CASE WHEN net_value_cents IS NULL THEN NULL ELSE value_cents - net_value_cents END) STORED,
    refunded_cents            bigint NOT NULL DEFAULT 0,
    due_date                  date NOT NULL,
    payment_date              date,
    client_payment_date       date,
    confirmed_date            date,
    credit_date               date,
    divergence_codes          text[] NOT NULL DEFAULT '{}',
    review_reason             text,
    last_event_at             timestamptz,
    first_seen_at             timestamptz NOT NULL DEFAULT now(),
    last_synced_at            timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_asaas_payments_env CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT finance_asaas_payments_ref CHECK (asaas_payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
    CONSTRAINT finance_asaas_payments_link CHECK (link_status IN ('unmatched', 'linked', 'review', 'ignored')),
    CONSTRAINT finance_asaas_payments_linked_entry CHECK (link_status <> 'linked' OR entry_id IS NOT NULL),
    CONSTRAINT finance_asaas_payments_additional CHECK (NOT is_additional OR char_length(coalesce(additional_justification, '')) >= 5),
    CONSTRAINT finance_asaas_payments_divergence CHECK (NOT divergence_accepted OR char_length(coalesce(divergence_justification, '')) >= 5),
    CONSTRAINT finance_asaas_payments_state CHECK (normalized_state IN ('open', 'overdue', 'confirmed', 'received', 'refund_pending',
        'refunded', 'partially_refunded', 'chargeback', 'deleted', 'unknown')),
    CONSTRAINT finance_asaas_payments_values CHECK (value_cents > 0 AND value_cents <= 100000000000
        AND (net_value_cents IS NULL OR (net_value_cents >= 0 AND net_value_cents <= value_cents))
        AND refunded_cents >= 0 AND refunded_cents <= value_cents),
    CONSTRAINT finance_asaas_payments_month CHECK (competence_month IS NULL OR competence_month = date_trunc('month', competence_month)::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_payments_external ON crm.finance_asaas_payments (environment, asaas_payment_id);
-- REGRA CRÍTICA: no máximo UMA cobrança externa principal vinculada a cada lançamento (competência).
-- Cobranças adicionais na mesma competência só com justificativa administrativa (is_additional).
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_payments_entry_primary
    ON crm.finance_asaas_payments (entry_id) WHERE link_status = 'linked' AND NOT is_additional;
CREATE INDEX IF NOT EXISTS idx_finance_asaas_payments_subscription
    ON crm.finance_asaas_payments (environment, asaas_subscription_id, competence_month);
CREATE INDEX IF NOT EXISTS idx_finance_asaas_payments_review ON crm.finance_asaas_payments (link_status) WHERE link_status IN ('unmatched', 'review');

-- Cobrança <-> movimentos do Financeiro: 1:N (cada movimento pertence a uma única cobrança externa).
CREATE TABLE IF NOT EXISTS crm.finance_asaas_payment_settlements (
    payment_link_id uuid NOT NULL REFERENCES crm.finance_asaas_payments (id),
    settlement_id   uuid NOT NULL REFERENCES crm.finance_settlements (id),
    kind            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_link_id, settlement_id),
    CONSTRAINT finance_asaas_payment_settlements_kind CHECK (kind IN ('receipt', 'manual_confirmed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_payment_settlements_settlement ON crm.finance_asaas_payment_settlements (settlement_id);

-- ── Eventos (webhook) ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.finance_asaas_events (
    id                bigserial PRIMARY KEY,
    environment       text NOT NULL,
    event_id          text NOT NULL,
    event_type        text NOT NULL,
    asaas_payment_id  text,
    event_created_at  timestamptz,
    received_at       timestamptz NOT NULL DEFAULT now(),
    status            text NOT NULL DEFAULT 'pending',
    attempts          integer NOT NULL DEFAULT 0,
    last_error        text,
    processed_at      timestamptz,
    payload_min       jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT finance_asaas_events_env CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT finance_asaas_events_status CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
    CONSTRAINT finance_asaas_events_texts CHECK (char_length(event_id) BETWEEN 1 AND 120 AND char_length(event_type) BETWEEN 1 AND 80
        AND (last_error IS NULL OR char_length(last_error) <= 120))
);
-- Repetição do mesmo evento nunca é processada duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_asaas_events ON crm.finance_asaas_events (environment, event_id);
CREATE INDEX IF NOT EXISTS idx_finance_asaas_events_pending ON crm.finance_asaas_events (status, received_at) WHERE status IN ('pending', 'failed');

-- ── Trilha da integração ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.finance_integration_log (
    id          bigserial PRIMARY KEY,
    provider    text NOT NULL DEFAULT 'asaas',
    environment text NOT NULL,
    entity      text NOT NULL,
    entity_ref  text NOT NULL,
    action      text NOT NULL,
    actor       text NOT NULL,
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_integration_log_env CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT finance_integration_log_entity CHECK (entity IN ('customer', 'subscription', 'payment', 'event'))
);
CREATE INDEX IF NOT EXISTS idx_finance_integration_log_ref ON crm.finance_integration_log (entity, entity_ref, created_at);

COMMIT;
