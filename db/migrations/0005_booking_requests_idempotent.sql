-- Mini CRM Cassiellos — 0005: reservas idempotentes do motor de agendamento
-- EXCLUSIVAMENTE Neon Preview. Não executar no Neon Production.
-- O agendamento real continua DESATIVADO ate os testes de ponta a ponta.
BEGIN;

CREATE TABLE crm.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE
    REFERENCES crm.form_submissions(id),
  lead_id uuid NOT NULL
    REFERENCES crm.leads(id),
  calendar_id text NOT NULL DEFAULT 'primary',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','confirmed','failed','cancelled')),
  google_event_id text UNIQUE,
  appointment_id uuid UNIQUE
    REFERENCES crm.appointments(id),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_requests_valid_interval CHECK (ends_at > starts_at)
);

-- Enquanto todos os encontros têm o mesmo tamanho de slot (30 minutos),
-- impede dois processos ativos de reservar o mesmo horário na mesma agenda.
-- Para durações variáveis no futuro, substituir por uma constraint de
-- sobreposição de intervalos (GiST) antes de habilitar outros tamanhos.
CREATE UNIQUE INDEX uq_crm_booking_active_slot
  ON crm.booking_requests(calendar_id, starts_at)
  WHERE status IN ('processing','confirmed');

CREATE INDEX idx_crm_booking_requests_created
  ON crm.booking_requests(created_at);

COMMIT;
