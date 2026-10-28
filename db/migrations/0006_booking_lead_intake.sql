-- Cassiellos CRM / 0006 — controle de captação. Executar SOMENTE Neon Preview.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_leads_email_normalized ON crm.leads (lower(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS crm.booking_intake_limits (
  fingerprint text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  last_request_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_booking_intake_limits_last ON crm.booking_intake_limits (last_request_at);
COMMIT;
