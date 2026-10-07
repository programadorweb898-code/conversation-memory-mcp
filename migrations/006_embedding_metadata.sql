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
  actual_dimensions INTEGER;
BEGIN
  SELECT atttypmod INTO actual_dimensions
  FROM pg_attribute
  WHERE attrelid = 'message_embeddings'::regclass
    AND attname = 'embedding'
    AND NOT attisdropped;

  -- pgvector stores vector(N) typmod as N + 4.
  IF actual_dimensions IS NOT NULL AND actual_dimensions <> 388 THEN
    RAISE EXCEPTION
      'message_embeddings.embedding has incompatible dimensions (typmod=%); expected vector(384)',
      actual_dimensions - 4;
  END IF;
END
$embedding_dimension$;
