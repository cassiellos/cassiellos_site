-- CRM Preview test-data classification, applied 2026-10-29.
-- Do not run against production. Preserve all existing history.
BEGIN;
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT true;
ALTER TABLE crm.appointments ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT true;
ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT true;
UPDATE crm.leads SET is_test = true WHERE id IN
('73d48138-c97e-4a33-b1b5-0c0bc489004c','8396d701-df18-4069-a626-81dadc727abe');
UPDATE crm.appointments SET is_test = true WHERE lead_id IN
('73d48138-c97e-4a33-b1b5-0c0bc489004c','8396d701-df18-4069-a626-81dadc727abe');
UPDATE crm.deals SET is_test = true WHERE lead_id IN
('73d48138-c97e-4a33-b1b5-0c0bc489004c','8396d701-df18-4069-a626-81dadc727abe');
COMMIT;
