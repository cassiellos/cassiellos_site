-- 0018 — Central de Inteligência de Marketing | MÉTRICAS E SINCRONIZAÇÃO (somente ADITIVA)
--
-- PREPARADA, NÃO APLICADA. Não executar no Neon sem autorização própria do titular. Requer a 0017.
-- Transação única; reexecutável; não altera nenhuma tabela existente. Reversão: db/ops/0017_0018_marketing_intel_rollback.sql.
--
--   mi_campaigns     campanhas por ativo (identidade: ativo + ID externo).
--   mi_ads_daily     métricas diárias de anúncios. `day` = data CIVIL NO FUSO DA CONTA; moeda por linha;
--                    dinheiro em MICROS (BIGINT); conversões NUMERIC (podem ser fracionárias) e NULL quando a plataforma
--                    não informa (≠ 0); definição da conversão e atribuição gravadas por linha.
--                    Idempotência: chave natural (ativo, campanha, dia, definição) + upsert (lib/crm/intel/sql.ts).
--   mi_ga4_daily     comportamento no site (GA4) por dia/origem/mídia/campanha — separado dos anúncios.
--   mi_gtm_snapshot  diagnóstico somente leitura do contêiner publicado (não é fonte de métricas).
--   mi_sync_jobs     execuções (fila): janela, gatilho, tentativas, linhas, erro SANITIZADO, lease contra concorrência.
--   mi_alerts        alertas abertos/resolvidos (autorização, limite, falha, parcial, desatualizado, conta suspensa).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.mi_campaigns (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id      uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    external_id   text NOT NULL,
    name          text NOT NULL,
    status        text NOT NULL,
    channel       text NOT NULL DEFAULT '',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mi_campaigns_external CHECK (external_id ~ '^[0-9A-Za-z_-]{1,40}$'),
    CONSTRAINT mi_campaigns_name CHECK (char_length(name) BETWEEN 1 AND 300),
    CONSTRAINT mi_campaigns_status CHECK (status IN ('active', 'paused', 'removed')),
    CONSTRAINT mi_campaigns_channel CHECK (char_length(channel) <= 60),
    CONSTRAINT mi_campaigns_identity UNIQUE (asset_id, external_id)
);

CREATE TABLE IF NOT EXISTS crm.mi_sync_jobs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id       uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    kind           text NOT NULL,
    trigger        text NOT NULL,
    range_start    date,
    range_end      date,
    status         text NOT NULL DEFAULT 'queued',
    attempts       integer NOT NULL DEFAULT 0,
    pages_done     integer NOT NULL DEFAULT 0,
    rows_inserted  integer NOT NULL DEFAULT 0,
    rows_updated   integer NOT NULL DEFAULT 0,
    rows_unchanged integer NOT NULL DEFAULT 0,
    error_kind     text,
    error_message  text,
    lease_owner    text,
    lease_until    timestamptz,
    next_attempt_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    started_at     timestamptz,
    finished_at    timestamptz,
    CONSTRAINT mi_sync_kind CHECK (kind IN ('ads_daily', 'ga4_daily', 'gtm_snapshot')),
    CONSTRAINT mi_sync_trigger CHECK (trigger IN ('schedule', 'manual', 'backfill', 'reprocess')),
    CONSTRAINT mi_sync_range CHECK ((range_start IS NULL) = (range_end IS NULL) AND (range_end IS NULL OR range_end >= range_start)),
    CONSTRAINT mi_sync_range_needed CHECK (kind = 'gtm_snapshot' OR range_start IS NOT NULL),
    CONSTRAINT mi_sync_status CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'skipped_locked')),
    CONSTRAINT mi_sync_attempts CHECK (attempts BETWEEN 0 AND 20 AND pages_done >= 0 AND rows_inserted >= 0 AND rows_updated >= 0 AND rows_unchanged >= 0),
    CONSTRAINT mi_sync_error_kind CHECK (error_kind IS NULL OR error_kind IN ('rate_limited', 'transient', 'auth_expired', 'auth_revoked', 'permission_denied', 'not_found', 'invalid_request')),
    CONSTRAINT mi_sync_error_message CHECK (error_message IS NULL OR char_length(error_message) <= 300),
    CONSTRAINT mi_sync_lease CHECK ((status = 'running') = (lease_until IS NOT NULL AND lease_owner IS NOT NULL))
);
-- Concorrência: no máximo UMA execução em andamento por ativo (garantia no banco, além do lease da aplicação).
CREATE UNIQUE INDEX IF NOT EXISTS mi_sync_one_running ON crm.mi_sync_jobs (asset_id) WHERE status = 'running';
-- Idempotência da fila: a mesma janela/gatilho não é enfileirada duas vezes enquanto pendente.
CREATE UNIQUE INDEX IF NOT EXISTS mi_sync_no_duplicate_pending ON crm.mi_sync_jobs (asset_id, kind, trigger, range_start, range_end) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_mi_sync_due ON crm.mi_sync_jobs (status, next_attempt_at) WHERE status IN ('queued', 'partial', 'failed');
CREATE INDEX IF NOT EXISTS idx_mi_sync_asset_recent ON crm.mi_sync_jobs (asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm.mi_ads_daily (
    asset_id                 uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    campaign_id              uuid NOT NULL REFERENCES crm.mi_campaigns(id) ON DELETE RESTRICT,
    day                      date NOT NULL,
    conversion_basis         text NOT NULL,
    currency_code            text NOT NULL,
    impressions              bigint NOT NULL DEFAULT 0,
    clicks                   bigint NOT NULL DEFAULT 0,
    cost_micros              bigint NOT NULL DEFAULT 0,
    conversions              numeric(18, 6),
    conversions_value_micros bigint,
    attribution              text NOT NULL,
    sync_job_id              uuid REFERENCES crm.mi_sync_jobs(id) ON DELETE SET NULL,
    fetched_at               timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, campaign_id, day, conversion_basis),
    CONSTRAINT mi_ads_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT mi_ads_non_negative CHECK (impressions >= 0 AND clicks >= 0 AND cost_micros >= 0 AND (conversions IS NULL OR conversions >= 0) AND (conversions_value_micros IS NULL OR conversions_value_micros >= 0)),
    CONSTRAINT mi_ads_basis CHECK (conversion_basis ~ '^[a-z0-9_:.-]{3,60}$'),
    CONSTRAINT mi_ads_attribution CHECK (char_length(attribution) BETWEEN 3 AND 80)
);
CREATE INDEX IF NOT EXISTS idx_mi_ads_day ON crm.mi_ads_daily (asset_id, day);

CREATE TABLE IF NOT EXISTS crm.mi_ga4_daily (
    asset_id         uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    day              date NOT NULL,
    session_source   text NOT NULL,
    session_medium   text NOT NULL,
    session_campaign text NOT NULL,
    sessions         bigint NOT NULL DEFAULT 0,
    total_users      bigint NOT NULL DEFAULT 0,
    engaged_sessions bigint NOT NULL DEFAULT 0,
    key_events       numeric(18, 6) NOT NULL DEFAULT 0,
    sync_job_id      uuid REFERENCES crm.mi_sync_jobs(id) ON DELETE SET NULL,
    fetched_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, day, session_source, session_medium, session_campaign),
    CONSTRAINT mi_ga4_dims CHECK (char_length(session_source) <= 200 AND char_length(session_medium) <= 200 AND char_length(session_campaign) <= 300),
    CONSTRAINT mi_ga4_non_negative CHECK (sessions >= 0 AND total_users >= 0 AND engaged_sessions >= 0 AND key_events >= 0)
);

CREATE TABLE IF NOT EXISTS crm.mi_gtm_snapshot (
    id                 bigserial PRIMARY KEY,
    asset_id           uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    live_version_id    text,
    last_published_at  timestamptz,
    tag_count          integer NOT NULL DEFAULT 0,
    has_ga4_tag        boolean NOT NULL DEFAULT false,
    has_meta_pixel_tag boolean NOT NULL DEFAULT false,
    sync_job_id        uuid REFERENCES crm.mi_sync_jobs(id) ON DELETE SET NULL,
    fetched_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mi_gtm_tags CHECK (tag_count >= 0),
    CONSTRAINT mi_gtm_version CHECK (live_version_id IS NULL OR live_version_id ~ '^[0-9]{1,12}$')
);
CREATE INDEX IF NOT EXISTS idx_mi_gtm_recent ON crm.mi_gtm_snapshot (asset_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS crm.mi_alerts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope         text NOT NULL,
    asset_id      uuid REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    connection_id uuid REFERENCES crm.mi_connections(id) ON DELETE RESTRICT,
    client_id     uuid REFERENCES crm.mi_clients(id) ON DELETE RESTRICT,
    kind          text NOT NULL,
    message       text NOT NULL DEFAULT '',
    opened_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at   timestamptz,
    CONSTRAINT mi_alerts_scope CHECK (
        (scope = 'asset' AND asset_id IS NOT NULL AND connection_id IS NULL AND client_id IS NULL) OR
        (scope = 'connection' AND connection_id IS NOT NULL AND asset_id IS NULL AND client_id IS NULL) OR
        (scope = 'client' AND client_id IS NOT NULL AND asset_id IS NULL AND connection_id IS NULL)),
    CONSTRAINT mi_alerts_kind CHECK (kind IN ('auth_expired', 'auth_revoked', 'permission_denied', 'rate_limited', 'sync_failed', 'sync_partial', 'stale_data', 'account_suspended', 'unlinked_asset', 'currency_mismatch')),
    CONSTRAINT mi_alerts_message CHECK (char_length(message) <= 300)
);
-- Deduplicação: um alerta ABERTO por alvo e tipo.
CREATE UNIQUE INDEX IF NOT EXISTS mi_alerts_open_asset ON crm.mi_alerts (asset_id, kind) WHERE resolved_at IS NULL AND scope = 'asset';
CREATE UNIQUE INDEX IF NOT EXISTS mi_alerts_open_connection ON crm.mi_alerts (connection_id, kind) WHERE resolved_at IS NULL AND scope = 'connection';
CREATE UNIQUE INDEX IF NOT EXISTS mi_alerts_open_client ON crm.mi_alerts (client_id, kind) WHERE resolved_at IS NULL AND scope = 'client';

COMMIT;
