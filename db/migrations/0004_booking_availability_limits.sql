-- Mini CRM Cassiellos / Preview only - 0004
-- Limite de consultas anonimas a disponibilidade. Guardar somente HMAC do IP.
-- Esta tabela nao armazena dados pessoais ou reservas.
BEGIN;
CREATE TABLE crm.booking_availability_limits (
  fingerprint text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  last_request_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_availability_limits_last_request
  ON crm.booking_availability_limits (last_request_at);
COMMIT;
