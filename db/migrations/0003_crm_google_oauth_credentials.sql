-- Mini CRM Cassiellos | 0003: cofre criptografado para integracoes OAuth
-- EXCLUSIVAMENTE Neon Preview: br-solitary-darkness-b67vm982
-- O token de atualizacao e criptografado com AES-256-GCM pelo servidor.
-- A chave de criptografia fica apenas em Secret da Vercel, nunca neste banco.
BEGIN;

CREATE TABLE crm.integration_credentials (
  provider text PRIMARY KEY
    CHECK (provider IN ('google_calendar')),
  encrypted_refresh_token text NOT NULL,
  granted_scopes text NOT NULL,
  token_expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_credentials_ciphertext_check
    CHECK (length(encrypted_refresh_token) >= 50)
);

COMMIT;
