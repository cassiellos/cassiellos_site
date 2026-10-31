-- 0012 — REVERSÃO. Remove apenas as duas situações administrativas (perde o que foi informado nelas).
-- Não toca em valores, cobranças, recebimentos nem no status financeiro. Somente com autorização expressa.
BEGIN;
DROP INDEX IF EXISTS crm.idx_finance_sources_awaiting_signature;
ALTER TABLE crm.finance_sources DROP CONSTRAINT IF EXISTS finance_sources_service_status;
ALTER TABLE crm.finance_sources DROP CONSTRAINT IF EXISTS finance_sources_formalization_status;
ALTER TABLE crm.finance_sources DROP COLUMN IF EXISTS admin_status_updated_at;
ALTER TABLE crm.finance_sources DROP COLUMN IF EXISTS formalization_status;
ALTER TABLE crm.finance_sources DROP COLUMN IF EXISTS service_status;
COMMIT;
