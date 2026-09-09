-- Multi-tenant: tokens de acceso por usuario/proyecto.
-- Cada token da acceso a un único proyecto (project) o a todos (project NULL).
-- Solo se almacena el hash SHA-256 del token, nunca el token en texto plano.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  project TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);