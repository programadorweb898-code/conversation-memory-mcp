-- Embedding storage contract for the active provider/model.
-- The singleton row makes the vector dimension, model and representation
-- explicit instead of relying on application constants alone.

CREATE TABLE IF NOT EXISTS embedding_metadata (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  dtype TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO embedding_metadata (id, provider, model, dimensions, dtype, version)
VALUES (1, 'transformers.js', 'Xenova/multilingual-e5-small', 384, 'q8', 1)
ON CONFLICT (id) DO NOTHING;

DO $embedding_dimension$
DECLARE
  actual_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO actual_type
  FROM pg_attribute a
  WHERE a.attrelid = 'message_embeddings'::regclass
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF actual_type IS NOT NULL AND actual_type <> 'vector(384)' THEN
    RAISE EXCEPTION
      'message_embeddings.embedding has incompatible type (%); expected vector(384)',
      actual_type;
  END IF;
END
$embedding_dimension$;
