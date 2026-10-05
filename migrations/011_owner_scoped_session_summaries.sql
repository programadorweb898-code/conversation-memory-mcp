-- Permite que owners distintos usen el mismo session_id sin colisionar.
-- Las filas existentes conservan su owner; los embeddings heredan el owner
-- del resumen al que ya estaban vinculados.

ALTER TABLE session_summary_embeddings
  ADD COLUMN IF NOT EXISTS owner TEXT;

UPDATE session_summary_embeddings e
SET owner = ss.owner
FROM session_summaries ss
WHERE ss.session_id = e.session_id
  AND e.owner IS DISTINCT FROM ss.owner;

ALTER TABLE session_summary_embeddings
  ALTER COLUMN owner SET NOT NULL;

ALTER TABLE session_summary_embeddings
  DROP CONSTRAINT IF EXISTS session_summary_embeddings_session_id_fkey;

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_pkey;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_pkey PRIMARY KEY (session_id, owner);

ALTER TABLE session_summary_embeddings
  DROP CONSTRAINT IF EXISTS session_summary_embeddings_pkey;

ALTER TABLE session_summary_embeddings
  ADD CONSTRAINT session_summary_embeddings_pkey PRIMARY KEY (session_id, owner);

ALTER TABLE session_summary_embeddings
  ADD CONSTRAINT session_summary_embeddings_session_owner_fkey
  FOREIGN KEY (session_id, owner)
  REFERENCES session_summaries(session_id, owner)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_session_summaries_owner_project
  ON session_summaries(owner, project);