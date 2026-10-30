-- 0009 — Ajuste final da disponibilidade e capacidade diária (Mini CRM Cassiellos)
--
-- PREPARADA, NÃO APLICADA. Aplicar somente no Neon PREVIEW e somente com autorização.
-- Requer a 0008. Transação única; reexecutável; não toca em leads, reuniões, reservas nem no Google.
--
-- 1) Antecedência mínima 3 h → 2 h e último início 17h30 → 18h00 (a reunião termina às 18h30):
--    muda os PADRÕES das colunas e a linha de configuração SOMENTE onde ainda estiver com o padrão
--    anterior (180 min / término 18h00). Valores personalizados pelo administrador são mantidos.
-- 2) Capacidade diária reservada para atividades internas (3 a 4 horários por dia útil, almoço
--    12h00–13h30 priorizado). A distribuição é calculada no código a partir da data e de uma
--    semente; aqui ficam só a configuração e os ajustes por data (liberar, reservar, desligar o dia).
--    Ajustes nunca são apagados: são revogados (revoked_at) para manter o histórico.

BEGIN;

ALTER TABLE crm.availability_settings ALTER COLUMN min_notice_minutes SET DEFAULT 120;
ALTER TABLE crm.availability_settings ALTER COLUMN close_minute SET DEFAULT 1110;

UPDATE crm.availability_settings
   SET min_notice_minutes = CASE WHEN min_notice_minutes = 180 THEN 120 ELSE min_notice_minutes END,
       close_minute       = CASE WHEN close_minute = 1080 THEN 1110 ELSE close_minute END,
       updated_at = now(),
       updated_by = 'migration:0009'
 WHERE id = 1 AND (min_notice_minutes = 180 OR close_minute = 1080);

CREATE TABLE IF NOT EXISTS crm.availability_capacity (
    id                  smallint PRIMARY KEY DEFAULT 1,
    enabled             boolean  NOT NULL DEFAULT true,
    min_per_day         smallint NOT NULL DEFAULT 3,
    max_per_day         smallint NOT NULL DEFAULT 4,
    lunch_start_minute  smallint NOT NULL DEFAULT 720,
    lunch_end_minute    smallint NOT NULL DEFAULT 810,
    seed                integer  NOT NULL DEFAULT 1,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          text,
    CONSTRAINT availability_capacity_singleton CHECK (id = 1),
    CONSTRAINT availability_capacity_count CHECK (
        min_per_day BETWEEN 0 AND 6 AND max_per_day BETWEEN 0 AND 6 AND max_per_day >= min_per_day),
    CONSTRAINT availability_capacity_lunch CHECK (
        lunch_start_minute BETWEEN 360 AND 1320 AND lunch_end_minute BETWEEN 360 AND 1320
        AND lunch_end_minute > lunch_start_minute
        AND lunch_start_minute % 30 = 0 AND lunch_end_minute % 30 = 0),
    CONSTRAINT availability_capacity_seed CHECK (seed BETWEEN 1 AND 1000000)
);

-- Configuração inicial: ligada, 3 a 4 horários por dia útil, almoço 12h00–13h30.
INSERT INTO crm.availability_capacity (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm.availability_capacity_overrides (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day         date NOT NULL,
    action      text NOT NULL,
    minute      smallint,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    revoked_at  timestamptz,
    revoked_by  text,
    CONSTRAINT availability_capacity_overrides_action CHECK (action IN ('release', 'hold', 'day_off')),
    CONSTRAINT availability_capacity_overrides_minute CHECK (
        (action = 'day_off' AND minute IS NULL) OR
        (action IN ('release', 'hold') AND minute IS NOT NULL AND minute BETWEEN 0 AND 1410 AND minute % 30 = 0)),
    CONSTRAINT availability_capacity_overrides_reason CHECK (char_length(reason) <= 200)
);
-- Um ajuste ativo por (dia, ação, horário).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_capacity_overrides_active
    ON crm.availability_capacity_overrides (day, action, COALESCE(minute, -1)) WHERE revoked_at IS NULL;

COMMIT;
