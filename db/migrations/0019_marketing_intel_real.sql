-- 0019 — Central de Inteligência | INTEGRAÇÕES REAIS (somente ADITIVA)
--
-- PREPARADA PARA O PREVIEW ISOLADO. Não executar no Neon de Production sem autorização própria do titular, backup
-- confirmado e plano de reversão (db/ops/0019_marketing_intel_real_rollback.sql). Requer 0017 e 0018.
-- Transação única; reexecutável (IF NOT EXISTS); NÃO altera nenhuma tabela existente.
--
--   mi_credentials   COFRE: segredo de plataforma CIFRADO (AES-256-GCM) com chave própria (MI_VAULT_KEYS), separada do
--                    Google Calendar. O banco guarda só iv + texto cifrado + tag; a chave nunca vem para o banco.
--                    `ref` é a mesma referência opaca gravada em mi_connections.credential_ref.
--   mi_oauth_states  `state` do OAuth: só o HASH (sha256), uso único, validade curta. O verificador PKCE é derivado no
--                    servidor (HMAC do state) — nada sensível é gravado.
--   mi_rate_marks    intervalo mínimo PERSISTENTE (ex.: 1 atualização manual por conta a cada 15 min), atômico entre instâncias.
--   mi_rate_limits   contador por janela fixa PERSISTENTE (ex.: teto global por minuto), atômico entre instâncias.
--   Substituem o controle N2 em memória para o modo real.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.mi_credentials (
    ref          text PRIMARY KEY,
    provider     text NOT NULL,
    key_version  integer NOT NULL,
    iv           bytea NOT NULL,
    ciphertext   bytea NOT NULL,
    auth_tag     bytea NOT NULL,
    scopes       text[] NOT NULL DEFAULT '{}',
    expires_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    rotated_at   timestamptz,
    revoked_at   timestamptz,
    CONSTRAINT mi_credentials_ref CHECK (ref ~ '^vault:[a-z0-9-]{1,32}:[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT mi_credentials_provider CHECK (provider IN ('google', 'meta')),
    CONSTRAINT mi_credentials_key_version CHECK (key_version BETWEEN 1 AND 1000),
    CONSTRAINT mi_credentials_iv CHECK (octet_length(iv) = 12),
    CONSTRAINT mi_credentials_tag CHECK (octet_length(auth_tag) = 16),
    CONSTRAINT mi_credentials_size CHECK (octet_length(ciphertext) BETWEEN 1 AND 16384),
    CONSTRAINT mi_credentials_scopes CHECK (cardinality(scopes) <= 20),
    -- revogada = material apagado (não fica texto cifrado de credencial revogada)
    CONSTRAINT mi_credentials_revoked_wiped CHECK (revoked_at IS NULL OR octet_length(ciphertext) = 1)
);
CREATE INDEX IF NOT EXISTS idx_mi_credentials_key ON crm.mi_credentials (key_version) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.mi_oauth_states (
    state_hash  text PRIMARY KEY,
    provider    text NOT NULL,
    actor       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    CONSTRAINT mi_oauth_states_hash CHECK (state_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT mi_oauth_states_provider CHECK (provider IN ('google', 'meta')),
    CONSTRAINT mi_oauth_states_actor CHECK (char_length(actor) BETWEEN 1 AND 80),
    CONSTRAINT mi_oauth_states_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);
CREATE INDEX IF NOT EXISTS idx_mi_oauth_states_expiry ON crm.mi_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS crm.mi_rate_marks (
    key      text PRIMARY KEY,
    last_at  timestamptz NOT NULL,
    CONSTRAINT mi_rate_marks_key CHECK (key ~ '^[a-z_]{3,40}:[0-9A-Za-z_-]{1,80}$')
);

CREATE TABLE IF NOT EXISTS crm.mi_rate_limits (
    bucket        text NOT NULL,
    window_start  timestamptz NOT NULL,
    hits          integer NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start),
    CONSTRAINT mi_rate_limits_bucket CHECK (bucket ~ '^[a-z_]{3,40}(:[0-9A-Za-z_-]{1,80})?$'),
    CONSTRAINT mi_rate_limits_hits CHECK (hits >= 0)
);

COMMIT;
