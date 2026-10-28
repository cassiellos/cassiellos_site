-- Mini CRM Cassiellos | 0002: proteção de tentativas de login
-- Aplicar APENAS no Neon Preview após a 0001 já existente.
-- Não executar no Neon Production sem aprovação explícita.
BEGIN;

CREATE TABLE crm.auth_login_attempts (
  fingerprint text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE INDEX idx_crm_auth_attempts_last_seen
  ON crm.auth_login_attempts (last_attempt_at);

COMMIT;
