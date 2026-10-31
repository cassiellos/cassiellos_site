-- 0012 — Financeiro: situação do SERVIÇO e situação do CONTRATO/FORMALIZAÇÃO (somente ADITIVA)
--
-- PREPARADA PARA O NEON PREVIEW (revisão e aplicação pela coordenação). Nunca aplicar em Production sem
-- autorização própria. Requer a 0011. Transação única; reexecutável; não remove nem reescreve nada.
--
-- Dois controles ADMINISTRATIVOS e INDEPENDENTES em crm.finance_sources (contratos/serviços):
--   service_status        unknown | not_started | in_progress | paused | ended
--   formalization_status  unknown | not_sent | sent | awaiting_signature | signed | no_formal_contract
-- Não substituem o status financeiro (finance_sources.status), não bloqueiam cadastro, cobrança nem recebimento e
-- não geram/cancelam lançamentos. Linhas existentes recebem 'unknown' ("Não informado") — nunca "Assinado"
-- automaticamente. DEFAULT constante: no PostgreSQL 11+ a coluna é adicionada sem reescrever a tabela.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm.finance_sources
    ADD COLUMN IF NOT EXISTS service_status text NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS formalization_status text NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS admin_status_updated_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_sources_service_status'
                     AND conrelid = 'crm.finance_sources'::regclass) THEN
        ALTER TABLE crm.finance_sources ADD CONSTRAINT finance_sources_service_status
            CHECK (service_status IN ('unknown', 'not_started', 'in_progress', 'paused', 'ended'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_sources_formalization_status'
                     AND conrelid = 'crm.finance_sources'::regclass) THEN
        ALTER TABLE crm.finance_sources ADD CONSTRAINT finance_sources_formalization_status
            CHECK (formalization_status IN ('unknown', 'not_sent', 'sent', 'awaiting_signature', 'signed', 'no_formal_contract'));
    END IF;
END $$;

-- Identificação rápida dos contratos aguardando assinatura.
CREATE INDEX IF NOT EXISTS idx_finance_sources_awaiting_signature
    ON crm.finance_sources (client_id) WHERE formalization_status = 'awaiting_signature';

COMMIT;
