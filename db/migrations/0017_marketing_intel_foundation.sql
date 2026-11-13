-- 0017 — Central de Inteligência de Marketing | FUNDAÇÃO (somente ADITIVA)
--
-- PREPARADA, NÃO APLICADA. Não executar no Neon (Preview ou Production) sem autorização própria do titular.
-- Requer a 0001 (schema crm, gen_random_uuid) e a 0011 (crm.finance_clients). Transação única; reexecutável
-- (IF NOT EXISTS); NÃO altera nenhuma tabela existente — em especial crm.integration_credentials (Google Calendar),
-- finance_*, leads, appointments e tracking/CAPI. Reversão: db/ops/0017_0018_marketing_intel_rollback.sql.
--
-- Modelo:
--   mi_clients        clientes MONITORADOS (separados do Financeiro). Vínculo OPCIONAL a crm.finance_clients
--                     (somente leitura; único). A Cassiellos é o cliente interno kind='agency' (no máximo um ativo).
--   mi_connections    autorizações (Google OAuth / usuário do sistema Meta). NÃO guarda segredo: só a REFERÊNCIA
--                     opaca a um cofre (credential_ref), cuja implementação será decidida em missão própria.
--   mi_assets         contas e propriedades externas (Google Ads, Meta Ads, GA4, GTM). Identidade externa única por
--                     (plataforma, contexto, ID normalizado). Moeda, fuso e situação da conta POR FONTE.
--   mi_asset_access   por qual conexão e caminho (direto ou conta gerente/MCC + login_customer_id) o ativo é lido.
--                     Um ativo pode ter mais de um caminho (ex.: direto hoje, MCC depois).
--   mi_client_assets  vínculo cliente × ativo com status: confirmed | probable | not_found | no_access | ended.
--                     Só `confirmed` alimenta métricas. Um ativo tem no máximo UM cliente confirmado, salvo
--                     compartilhamento justificado e validado (shared_justification).
--   mi_audit_log      trilha administrativa da Central (conectar, revogar, vincular, validar, sincronizar manualmente).
--
-- Revisão de redundância (decisão da fundação):
--   * Não há tabela de "plataformas": o conjunto é fixo (CHECK) — evita junções e dados de referência mutáveis.
--   * mi_asset_access fica separada de mi_assets: o mesmo ativo pode ser lido por N conexões/caminhos.
--   * mi_fx_rates fica para fase posterior: a fundação NÃO converte moedas (totais sempre por moeda).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.mi_clients (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    kind              text NOT NULL DEFAULT 'client',
    status            text NOT NULL DEFAULT 'active',
    finance_client_id uuid REFERENCES crm.finance_clients(id) ON DELETE RESTRICT,
    report_timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
    notes             text NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    archived_at       timestamptz,
    CONSTRAINT mi_clients_name CHECK (char_length(name) BETWEEN 2 AND 160),
    CONSTRAINT mi_clients_kind CHECK (kind IN ('agency', 'client')),
    CONSTRAINT mi_clients_status CHECK (status IN ('active', 'paused', 'archived')),
    CONSTRAINT mi_clients_archived CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CONSTRAINT mi_clients_tz CHECK (report_timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' AND char_length(report_timezone) <= 64),
    CONSTRAINT mi_clients_notes CHECK (char_length(notes) <= 2000),
    CONSTRAINT mi_clients_finance_unique UNIQUE (finance_client_id)
);
-- No máximo UM cliente interno da agência ativo.
CREATE UNIQUE INDEX IF NOT EXISTS mi_clients_one_agency ON crm.mi_clients (kind) WHERE kind = 'agency' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.mi_connections (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider         text NOT NULL,
    auth_kind        text NOT NULL,
    label            text NOT NULL,
    status           text NOT NULL DEFAULT 'pending',
    scopes           text[] NOT NULL DEFAULT '{}',
    -- Referência opaca ao cofre de credenciais (lib/crm/intel/credential-vault.ts). NUNCA o segredo.
    credential_ref   text,
    -- Identificação mascarada de quem autorizou (ex.: "ca***@***.com"); nunca e-mail completo nem token.
    principal_hint   text,
    expires_at       timestamptz,
    last_verified_at timestamptz,
    last_error_code  text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz,
    CONSTRAINT mi_connections_provider CHECK (provider IN ('google', 'meta')),
    CONSTRAINT mi_connections_auth_kind CHECK (auth_kind IN ('oauth_user', 'system_user')),
    CONSTRAINT mi_connections_label CHECK (char_length(label) BETWEEN 2 AND 120),
    CONSTRAINT mi_connections_status CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
    CONSTRAINT mi_connections_ref_format CHECK (credential_ref IS NULL OR credential_ref ~ '^vault:[a-z0-9-]{1,32}:[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT mi_connections_active_needs_ref CHECK (status <> 'active' OR credential_ref IS NOT NULL),
    CONSTRAINT mi_connections_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT mi_connections_hint CHECK (principal_hint IS NULL OR char_length(principal_hint) <= 120),
    CONSTRAINT mi_connections_error CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{2,40}$'),
    CONSTRAINT mi_connections_scopes CHECK (cardinality(scopes) <= 20)
);

CREATE TABLE IF NOT EXISTS crm.mi_assets (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform         text NOT NULL,
    external_id      text NOT NULL,
    external_context text NOT NULL DEFAULT '',
    name             text NOT NULL,
    currency_code    text,
    time_zone        text,
    account_status   text NOT NULL DEFAULT 'unknown',
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz,
    deactivated_at   timestamptz,
    CONSTRAINT mi_assets_platform CHECK (platform IN ('google_ads', 'meta_ads', 'ga4', 'gtm')),
    CONSTRAINT mi_assets_external_id CHECK (
        (platform = 'google_ads' AND external_id ~ '^[0-9]{10}$') OR
        (platform = 'meta_ads'   AND external_id ~ '^[0-9]{5,20}$') OR
        (platform = 'ga4'        AND external_id ~ '^[0-9]{5,15}$') OR
        (platform = 'gtm'        AND external_id ~ '^GTM-[A-Z0-9]{4,12}$')),
    CONSTRAINT mi_assets_context CHECK (external_context ~ '^[0-9A-Za-z_-]{0,40}$'),
    CONSTRAINT mi_assets_name CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT mi_assets_currency CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT mi_assets_tz CHECK (time_zone IS NULL OR (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' AND char_length(time_zone) <= 64)),
    CONSTRAINT mi_assets_account_status CHECK (account_status IN ('active', 'paused', 'suspended', 'closed', 'unknown')),
    CONSTRAINT mi_assets_identity UNIQUE (platform, external_context, external_id)
);

CREATE TABLE IF NOT EXISTS crm.mi_asset_access (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id          uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    connection_id     uuid NOT NULL REFERENCES crm.mi_connections(id) ON DELETE RESTRICT,
    access_path       text NOT NULL,
    login_customer_id text,
    verified_at       timestamptz,
    revoked_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mi_asset_access_path CHECK (access_path IN ('direct', 'manager')),
    CONSTRAINT mi_asset_access_login CHECK ((access_path = 'manager') = (login_customer_id IS NOT NULL)),
    CONSTRAINT mi_asset_access_login_format CHECK (login_customer_id IS NULL OR login_customer_id ~ '^[0-9]{10}$'),
    CONSTRAINT mi_asset_access_unique UNIQUE (asset_id, connection_id, access_path)
);

CREATE TABLE IF NOT EXISTS crm.mi_client_assets (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            uuid NOT NULL REFERENCES crm.mi_clients(id) ON DELETE RESTRICT,
    asset_id             uuid NOT NULL REFERENCES crm.mi_assets(id) ON DELETE RESTRICT,
    status               text NOT NULL DEFAULT 'probable',
    note                 text NOT NULL DEFAULT '',
    shared_justification text,
    validated_by         text,
    validated_at         timestamptz,
    valid_from           timestamptz NOT NULL DEFAULT now(),
    valid_to             timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mi_client_assets_status CHECK (status IN ('confirmed', 'probable', 'not_found', 'no_access', 'ended')),
    -- Confirmado exige validação registrada (quem e quando). Prováveis NUNCA alimentam métricas (regra da aplicação + view).
    CONSTRAINT mi_client_assets_confirmed_validated CHECK (status <> 'confirmed' OR (validated_at IS NOT NULL AND validated_by IS NOT NULL)),
    -- Desativação lógica: vínculo encerrado mantém o histórico (valid_to).
    CONSTRAINT mi_client_assets_ended CHECK ((status = 'ended') = (valid_to IS NOT NULL)),
    CONSTRAINT mi_client_assets_note CHECK (char_length(note) <= 500),
    CONSTRAINT mi_client_assets_justification CHECK (shared_justification IS NULL OR char_length(shared_justification) BETWEEN 10 AND 500)
);
-- Um vínculo vigente por (cliente, ativo).
CREATE UNIQUE INDEX IF NOT EXISTS mi_client_assets_current ON crm.mi_client_assets (client_id, asset_id) WHERE status <> 'ended';
-- Um ativo só pode estar CONFIRMADO para um cliente, salvo compartilhamento justificado (evita mistura de dados).
CREATE UNIQUE INDEX IF NOT EXISTS mi_client_assets_one_owner ON crm.mi_client_assets (asset_id) WHERE status = 'confirmed' AND shared_justification IS NULL;
CREATE INDEX IF NOT EXISTS idx_mi_client_assets_client ON crm.mi_client_assets (client_id) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS crm.mi_audit_log (
    id         bigserial PRIMARY KEY,
    actor      text NOT NULL,
    action     text NOT NULL,
    entity     text NOT NULL,
    entity_id  text NOT NULL,
    details    jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mi_audit_actor CHECK (char_length(actor) BETWEEN 1 AND 80),
    CONSTRAINT mi_audit_action CHECK (action ~ '^[a-z_]{3,40}$'),
    CONSTRAINT mi_audit_entity CHECK (entity IN ('client', 'connection', 'asset', 'asset_access', 'client_asset', 'sync_job')),
    CONSTRAINT mi_audit_details CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_mi_audit_entity ON crm.mi_audit_log (entity, entity_id, created_at);

COMMIT;
