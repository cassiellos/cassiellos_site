-- 0015 — Projetos avulsos com até 5 parcelas de vencimentos livres (Preview)
-- Adição não destrutiva: não modifica lançamentos nem índices existentes.
-- A fonte do projeto é única; cada parcela é um lançamento independente com sua competência.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm.finance_sources
  ADD COLUMN IF NOT EXISTS installment_plan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_due_date date;

ALTER TABLE crm.finance_entries
  ADD COLUMN IF NOT EXISTS project_source_id uuid REFERENCES crm.finance_sources(id),
  ADD COLUMN IF NOT EXISTS installment_number smallint;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_project_installment
 ON crm.finance_entries (project_source_id, installment_number)
 WHERE project_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_project_entries
 ON crm.finance_entries (project_source_id, competence_month)
 WHERE project_source_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_entries_installment_integrity' AND connamespace = 'crm'::regnamespace) THEN
    ALTER TABLE crm.finance_entries ADD CONSTRAINT finance_entries_installment_integrity
      CHECK ((project_source_id IS NULL AND installment_number IS NULL)
        OR (project_source_id IS NOT NULL AND source_id IS NULL AND installment_number BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_sources_installment_kind' AND connamespace = 'crm'::regnamespace) THEN
    ALTER TABLE crm.finance_sources ADD CONSTRAINT finance_sources_installment_kind
      CHECK (NOT installment_plan OR (direction = 'in' AND periodicity = 'one_time'));
  END IF;
END $$;
COMMIT;
