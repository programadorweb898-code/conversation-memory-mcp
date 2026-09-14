-- Aislamiento multi-tenant por usuario (owner).
-- Cada api_key pertenece a un dueño (owner); los datos de conversaciones,
-- resúmenes y candidatos de memoria quedan asociados a ese owner.
-- El owner NUNCA se recibe del request: se deriva del token autenticado.
--
-- Los datos existentes (previos a esta migración) se asignan al dueño por
-- defecto indicado por MCP_DEFAULT_OWNER (placeholder ${MCP_DEFAULT_OWNER}).

-- 1) Columnas
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE session_summaries ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS owner TEXT;

-- 2) Backfill: los datos existentes pertenecen al dueño por defecto.
UPDATE api_keys
SET owner = COALESCE(NULLIF(TRIM(owner), ''), '${MCP_DEFAULT_OWNER}')
WHERE owner IS NULL OR TRIM(owner) = '';

UPDATE conversations SET owner = '${MCP_DEFAULT_OWNER}' WHERE owner IS NULL OR owner = '';
UPDATE session_summaries SET owner = '${MCP_DEFAULT_OWNER}' WHERE owner IS NULL OR owner = '';
UPDATE memory_candidates SET owner = '${MCP_DEFAULT_OWNER}' WHERE owner IS NULL OR owner = '';

-- 2.1) Normalización: una sesión no debe tener filas con owners mezclados.
-- Se unifica cada sesión histórica al primer (mínimo) owner registrado.
UPDATE conversations c
SET owner = uni.owner
FROM (
  SELECT session_id, MIN(owner) AS owner
  FROM conversations
  GROUP BY session_id
  HAVING COUNT(DISTINCT owner) > 1
) uni
WHERE c.session_id = uni.session_id;

UPDATE session_summaries ss
SET owner = uni.owner
FROM (
  SELECT session_id, MIN(owner) AS owner
  FROM conversations
  GROUP BY session_id
) uni
WHERE ss.session_id = uni.session_id;

-- 3) Obligatorio + default de seguridad.
ALTER TABLE api_keys ALTER COLUMN owner SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN owner SET DEFAULT '${MCP_DEFAULT_OWNER}';
ALTER TABLE conversations ALTER COLUMN owner SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN owner SET DEFAULT '${MCP_DEFAULT_OWNER}';
ALTER TABLE session_summaries ALTER COLUMN owner SET NOT NULL;
ALTER TABLE session_summaries ALTER COLUMN owner SET DEFAULT '${MCP_DEFAULT_OWNER}';
ALTER TABLE memory_candidates ALTER COLUMN owner SET NOT NULL;
ALTER TABLE memory_candidates ALTER COLUMN owner SET DEFAULT '${MCP_DEFAULT_OWNER}';

-- 4) Índices de aislamiento.
CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner);
CREATE INDEX IF NOT EXISTS idx_conversations_owner_project ON conversations(owner, project);
CREATE INDEX IF NOT EXISTS idx_session_summaries_owner ON session_summaries(owner);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_owner ON memory_candidates(owner);