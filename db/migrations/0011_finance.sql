-- 0011 — Módulo Financeiro do CRM | Cassiellos (somente ADITIVA)
--
-- PREPARADA PARA O NEON PREVIEW. Nunca aplicar em Production sem autorização própria.
-- Requer a 0001 (schema crm e gen_random_uuid). Transação única; reexecutável (IF NOT EXISTS); não toca em
-- nenhuma tabela existente (leads, reuniões, reservas, disponibilidade, Web Push).
--
-- Modelo (valores SEMPRE em centavos inteiros, BIGINT — nunca float):
--   finance_clients      clientes do financeiro (independentes dos leads comerciais)
--   finance_sources      origens recorrentes ou únicas: CONTRATOS (direction = 'in') e DESPESAS (direction = 'out');
--                        generate_from = primeiro mês de competência a gerar (evita cobrar meses anteriores ao cadastro
--                        ou ao período de pausa)
--   finance_entries      cobranças (a receber) e contas (a pagar) por COMPETÊNCIA; geração idempotente por
--                        (origem, mês de competência)
--   finance_settlements  recebimentos e pagamentos REAIS (data e valor); idempotentes por chave; nunca apagados —
--                        estornos ficam registrados (reversed_at)
--   finance_invoices     controle administrativo de notas fiscais por cobrança (sem emissão automática)
--   finance_audit_log    trilha de auditoria de toda alteração financeira
-- Estados como "recebido", "parcial" e "atrasado" são CALCULADOS a partir dos movimentos (não ficam gravados).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.finance_clients (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    company     text,
    notes       text NOT NULL DEFAULT '',
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_clients_name CHECK (char_length(name) BETWEEN 2 AND 160),
    CONSTRAINT finance_clients_company CHECK (company IS NULL OR char_length(company) <= 160),
    CONSTRAINT finance_clients_notes CHECK (char_length(notes) <= 2000)
);

CREATE TABLE IF NOT EXISTS crm.finance_sources (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    direction        text NOT NULL,
    client_id        uuid REFERENCES crm.finance_clients (id),
    category         text NOT NULL,
    description      text NOT NULL,
    supplier         text,
    amount_cents     bigint NOT NULL,
    periodicity      text NOT NULL,
    cost_kind        text,
    start_date       date NOT NULL,
    end_date         date,
    due_day          smallint NOT NULL,
    generate_from    date NOT NULL,
    status           text NOT NULL DEFAULT 'active',
    invoice_required boolean NOT NULL DEFAULT false,
    client_ad_budget boolean NOT NULL DEFAULT false,
    notes            text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_sources_direction CHECK (direction IN ('in', 'out')),
    -- Contrato sempre tem cliente; despesa só tem cliente quando é verba de anúncio de um cliente.
    CONSTRAINT finance_sources_client CHECK ((direction = 'in' AND client_id IS NOT NULL)
        OR (direction = 'out' AND (client_id IS NULL OR client_ad_budget))),
    CONSTRAINT finance_sources_category CHECK (
        (direction = 'in' AND category IN ('marketing_monthly', 'creative_minds', 'hosting', 'site_maintenance',
                                           'site_creation', 'project', 'other_revenue'))
     OR (direction = 'out' AND category IN ('infrastructure', 'software', 'team', 'agency_ads', 'taxes', 'office',
                                            'outsourced', 'other_expense'))),
    CONSTRAINT finance_sources_amount CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    CONSTRAINT finance_sources_periodicity CHECK (periodicity IN ('monthly', 'quarterly', 'semiannual', 'annual', 'one_time')),
    CONSTRAINT finance_sources_cost_kind CHECK (
        (direction = 'in' AND cost_kind IS NULL) OR (direction = 'out' AND cost_kind IN ('fixed', 'variable'))),
    CONSTRAINT finance_sources_dates CHECK ((end_date IS NULL OR end_date >= start_date)
        AND generate_from = date_trunc('month', generate_from)::date
        AND generate_from >= date_trunc('month', start_date)::date),
    CONSTRAINT finance_sources_due_day CHECK (due_day BETWEEN 1 AND 31),
    CONSTRAINT finance_sources_status CHECK (status IN ('active', 'paused', 'ended')),
    CONSTRAINT finance_sources_ad_budget CHECK (NOT client_ad_budget OR direction = 'out'),
    CONSTRAINT finance_sources_texts CHECK (char_length(description) BETWEEN 2 AND 200
        AND (supplier IS NULL OR char_length(supplier) <= 160) AND char_length(notes) <= 2000)
);
CREATE INDEX IF NOT EXISTS idx_finance_sources_client ON crm.finance_sources (client_id);
CREATE INDEX IF NOT EXISTS idx_finance_sources_active ON crm.finance_sources (direction, status);

CREATE TABLE IF NOT EXISTS crm.finance_entries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    direction        text NOT NULL,
    source_id        uuid REFERENCES crm.finance_sources (id),
    client_id        uuid REFERENCES crm.finance_clients (id),
    category         text NOT NULL,
    description      text NOT NULL,
    competence_month date NOT NULL,
    due_date         date NOT NULL,
    amount_cents     bigint NOT NULL,
    invoice_required boolean NOT NULL DEFAULT false,
    client_ad_budget boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'open',
    cancelled_at     timestamptz,
    cancel_reason    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_entries_direction CHECK (direction IN ('in', 'out')),
    CONSTRAINT finance_entries_month CHECK (competence_month = date_trunc('month', competence_month)::date),
    CONSTRAINT finance_entries_amount CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    CONSTRAINT finance_entries_status CHECK (status IN ('open', 'cancelled')),
    CONSTRAINT finance_entries_cancel CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT finance_entries_texts CHECK (char_length(description) BETWEEN 2 AND 200
        AND (cancel_reason IS NULL OR char_length(cancel_reason) <= 300))
);
-- Geração idempotente: no máximo UMA cobrança/conta por origem e mês de competência.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_entries_source_month
    ON crm.finance_entries (source_id, competence_month) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_entries_month ON crm.finance_entries (direction, competence_month);
CREATE INDEX IF NOT EXISTS idx_finance_entries_due ON crm.finance_entries (direction, due_date) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_finance_entries_client ON crm.finance_entries (client_id);

CREATE TABLE IF NOT EXISTS crm.finance_settlements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id        uuid NOT NULL REFERENCES crm.finance_entries (id),
    amount_cents    bigint NOT NULL,
    settled_on      date NOT NULL,
    method          text NOT NULL DEFAULT '',
    notes           text NOT NULL DEFAULT '',
    idempotency_key uuid NOT NULL,
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    reversed_at     timestamptz,
    reversed_by     text,
    reversal_reason text,
    CONSTRAINT finance_settlements_amount CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    CONSTRAINT finance_settlements_reversal CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
    CONSTRAINT finance_settlements_texts CHECK (char_length(method) <= 60 AND char_length(notes) <= 500
        AND (reversal_reason IS NULL OR char_length(reversal_reason) <= 300))
);
-- Repetição da mesma requisição nunca registra o movimento duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_settlements_key ON crm.finance_settlements (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_entry ON crm.finance_settlements (entry_id);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_date ON crm.finance_settlements (settled_on) WHERE reversed_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.finance_invoices (
    entry_id     uuid PRIMARY KEY REFERENCES crm.finance_entries (id),
    status       text NOT NULL,
    number       text,
    issued_on    date,
    external_ref text,
    notes        text NOT NULL DEFAULT '',
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text NOT NULL,
    CONSTRAINT finance_invoices_status CHECK (status IN ('pending', 'issued', 'not_applicable', 'cancelled')),
    CONSTRAINT finance_invoices_issued CHECK (status <> 'issued' OR (number IS NOT NULL AND issued_on IS NOT NULL)),
    CONSTRAINT finance_invoices_texts CHECK ((number IS NULL OR char_length(number) <= 60)
        AND (external_ref IS NULL OR char_length(external_ref) <= 200) AND char_length(notes) <= 1000)
);

CREATE TABLE IF NOT EXISTS crm.finance_audit_log (
    id         bigserial PRIMARY KEY,
    entity     text NOT NULL,
    entity_id  uuid NOT NULL,
    action     text NOT NULL,
    actor      text NOT NULL,
    details    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_audit_entity CHECK (entity IN ('client', 'source', 'entry', 'settlement', 'invoice'))
);
CREATE INDEX IF NOT EXISTS idx_finance_audit_entity ON crm.finance_audit_log (entity, entity_id, created_at);

COMMIT;
