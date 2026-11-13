-- SOMENTE PARA POSTGRESQL LOCAL DESCARTÁVEL (scripts/crm-local-sandbox-db.sh). NUNCA aplicar no Neon.
-- Marcador exigido pelos testes destrutivos da integração Asaas: um banco sem este marcador (ex.: Neon Preview ou
-- Production) é recusado pelos testes antes de qualquer gravação.
CREATE SCHEMA IF NOT EXISTS crm_local_test;
CREATE TABLE IF NOT EXISTS crm_local_test.marker (
    kind       text PRIMARY KEY CHECK (kind = 'disposable-local'),
    mode       text NOT NULL CHECK (mode IN ('sandbox', 'fresh16', 'pre16', 'pre12', 'upto12', 'fresh19')),
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm_local_test.marker (kind, mode) VALUES ('disposable-local', :'mode') ON CONFLICT (kind) DO NOTHING;
