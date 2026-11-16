-- 0020 — CRM Cassiellos: construtor visual de formulários ramificados.
-- ADITIVA e sem backfill: o /agendar original permanece independente.
-- Publicar um fluxo NÃO modifica o rascunho; editar rascunho NÃO muda o formulário público.
-- Requer aplicação explícita no banco destino antes de habilitar a interface.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm.form_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(120) NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
  slug varchar(70) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description varchar(400) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  draft jsonb NOT NULL,
  published jsonb,
  published_meta jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_version integer NOT NULL DEFAULT 0 CHECK (published_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT form_flows_publish_consistency CHECK ((status = 'draft' AND published IS NULL AND published_meta IS NULL AND published_version >= 0) OR
    (status = 'published' AND published IS NOT NULL AND published_meta IS NOT NULL AND published_version > 0))
);
CREATE INDEX IF NOT EXISTS form_flows_updated ON crm.form_flows (updated_at DESC);
-- Histórico somente com IDs e números de revisão, sem respostas de usuários nem credenciais.
CREATE TABLE IF NOT EXISTS crm.form_flow_audit (
  id bigserial PRIMARY KEY,
  flow_id uuid NOT NULL REFERENCES crm.form_flows(id),
  action text NOT NULL CHECK (action IN ('created','draft_saved','published','unpublished')),
  from_revision integer,
  to_revision integer NOT NULL,
  actor text NOT NULL DEFAULT 'crm_admin',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS form_flow_audit_flow_at ON crm.form_flow_audit (flow_id,at DESC);
COMMIT;
