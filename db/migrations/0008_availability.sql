-- 0008 — Disponibilidade, feriados e bloqueios de agenda (Mini CRM Cassiellos)
--
-- PREPARADA, NÃO APLICADA. Aplicar somente no Neon PREVIEW e somente com autorização (decisão D4).
-- Não destrutiva e reexecutável: só cria o que não existe; nada é apagado ou alterado.
-- Os feriados ficam no código (lib/crm/availability/holidays.ts); aqui ficam apenas os AJUSTES do
-- administrador (crm.holiday_rules), a configuração, os bloqueios manuais e as exceções.
-- Bloqueios e exceções nunca são apagados: são revogados (revoked_at) para manter o histórico.

BEGIN;

CREATE TABLE IF NOT EXISTS crm.availability_settings (
    id                 smallint PRIMARY KEY DEFAULT 1,
    working_days       smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
    open_minute        smallint NOT NULL DEFAULT 540,
    close_minute       smallint NOT NULL DEFAULT 1080,
    slot_minutes       smallint NOT NULL DEFAULT 30,
    min_notice_minutes integer  NOT NULL DEFAULT 720,
    window_days        smallint NOT NULL DEFAULT 30,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    updated_by         text,
    CONSTRAINT availability_settings_singleton CHECK (id = 1),
    CONSTRAINT availability_settings_days CHECK (
        cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
    CONSTRAINT availability_settings_hours CHECK (
        open_minute >= 360 AND close_minute <= 1320 AND close_minute - open_minute >= 30
        AND open_minute % 30 = 0 AND close_minute % 30 = 0),
    CONSTRAINT availability_settings_slot CHECK (slot_minutes = 30),
    CONSTRAINT availability_settings_notice CHECK (min_notice_minutes BETWEEN 0 AND 10080),
    CONSTRAINT availability_settings_window CHECK (window_days BETWEEN 1 AND 90)
);

-- Configuração inicial (D3): seg–sex, 09h–18h, 30 min, 12 h de antecedência, 30 dias.
INSERT INTO crm.availability_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm.availability_blocks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    category    text NOT NULL,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    revoked_at  timestamptz,
    revoked_by  text,
    CONSTRAINT availability_blocks_range CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '367 days'),
    CONSTRAINT availability_blocks_category CHECK (category IN ('day', 'partial', 'vacation', 'recess', 'other')),
    CONSTRAINT availability_blocks_reason CHECK (char_length(reason) <= 200)
);
CREATE INDEX IF NOT EXISTS idx_crm_availability_blocks_active
    ON crm.availability_blocks (starts_at, ends_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.availability_exceptions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    revoked_at  timestamptz,
    revoked_by  text,
    CONSTRAINT availability_exceptions_range CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '1 day'),
    CONSTRAINT availability_exceptions_reason CHECK (char_length(reason) <= 200)
);
CREATE INDEX IF NOT EXISTS idx_crm_availability_exceptions_active
    ON crm.availability_exceptions (starts_at, ends_at) WHERE revoked_at IS NULL;

-- Ajustes do administrador sobre o catálogo de feriados/políticas (year NULL = todos os anos).
CREATE TABLE IF NOT EXISTS crm.holiday_rules (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key      text NOT NULL,
    year          smallint,
    block_type    text NOT NULL,
    block_minute  smallint,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text,
    CONSTRAINT holiday_rules_type CHECK (block_type IN ('none', 'full', 'until', 'after')),
    CONSTRAINT holiday_rules_minute CHECK (
        (block_type IN ('none', 'full') AND block_minute IS NULL) OR
        (block_type IN ('until', 'after') AND block_minute IS NOT NULL
         AND block_minute BETWEEN 30 AND 1410 AND block_minute % 30 = 0)),
    CONSTRAINT holiday_rules_year CHECK (year IS NULL OR year BETWEEN 2024 AND 2100)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_holiday_rules_key_year
    ON crm.holiday_rules (rule_key, COALESCE(year, 0));

COMMIT;
