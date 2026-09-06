-- Baseline migration for the current conversation-memory-mcp schema.
-- Safe for an existing database: it only creates missing objects and fills
-- missing sequence values; it does not delete application data.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  project TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT,
  related_message_id TEXT,
  sequence_id BIGINT
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS related_message_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sequence_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project);
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);

CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id TEXT PRIMARY KEY,
  embedding vector(384) NOT NULL,
  FOREIGN KEY(message_id) REFERENCES conversations(id)
);

DO $embedding$
DECLARE
  embedding_udt TEXT;
BEGIN
  SELECT udt_name INTO embedding_udt
  FROM information_schema.columns
  WHERE table_name = 'message_embeddings'
    AND column_name = 'embedding'
    AND table_schema = current_schema();

  IF embedding_udt = 'text' THEN
    ALTER TABLE message_embeddings
      ALTER COLUMN embedding TYPE vector(384)
      USING embedding::vector;
  END IF;
END
$embedding$;

CREATE INDEX IF NOT EXISTS idx_message_embeddings_hnsw_cosine
  ON message_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS embedding_failures (
  message_id TEXT PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  topic_key TEXT,
  what TEXT,
  why TEXT,
  where_context TEXT,
  learned TEXT,
  importance TEXT,
  status TEXT NOT NULL,
  source_message_ids JSONB NOT NULL DEFAULT '[]',
  engram_id TEXT,
  engram_topic_key TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  audited_at TIMESTAMP,
  promoted_at TIMESTAMP,
  CONSTRAINT chk_memory_candidates_status CHECK (
    status IN ('missing', 'already_exists', 'related', 'possible_duplicate', 'conflict', 'pending', 'discard')
  ),
  CONSTRAINT chk_memory_candidates_type CHECK (
    type IN ('decision', 'discovery', 'constraint', 'configuration', 'lesson')
  )
);

DO $memory_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'memory_candidates'::regclass
      AND conname = 'chk_memory_candidates_status'
  ) THEN
    ALTER TABLE memory_candidates ADD CONSTRAINT chk_memory_candidates_status CHECK (
      status IN ('missing', 'already_exists', 'related', 'possible_duplicate', 'conflict', 'pending', 'discard')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'memory_candidates'::regclass
      AND conname = 'chk_memory_candidates_type'
  ) THEN
    ALTER TABLE memory_candidates ADD CONSTRAINT chk_memory_candidates_type CHECK (
      type IN ('decision', 'discovery', 'constraint', 'configuration', 'lesson')
    );
  END IF;
END
$memory_constraints$;

CREATE INDEX IF NOT EXISTS idx_memory_candidates_project ON memory_candidates(project);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_session_id ON memory_candidates(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_status ON memory_candidates(status);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  summary TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_processed_seq_id BIGINT
);

ALTER TABLE session_summaries ADD COLUMN IF NOT EXISTS project TEXT;

DO $summary_seq$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'session_summaries'
      AND column_name = 'last_processed_message_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'session_summaries'
      AND column_name = 'last_processed_seq_id'
  ) THEN
    ALTER TABLE session_summaries RENAME COLUMN last_processed_message_id TO last_processed_seq_id;
  END IF;
END
$summary_seq$;

ALTER TABLE session_summaries ADD COLUMN IF NOT EXISTS last_processed_seq_id BIGINT;

UPDATE session_summaries
SET last_processed_seq_id = NULL
WHERE last_processed_seq_id IS NOT NULL
  AND last_processed_seq_id::text ~ '[^0-9]';

DO $summary_type$
DECLARE
  column_type TEXT;
BEGIN
  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'session_summaries'
    AND column_name = 'last_processed_seq_id';

  IF column_type IS NOT NULL AND column_type <> 'bigint' THEN
    ALTER TABLE session_summaries
      ALTER COLUMN last_processed_seq_id TYPE BIGINT
      USING last_processed_seq_id::bigint;
  END IF;
END
$summary_type$;

CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);

CREATE TABLE IF NOT EXISTS session_summary_embeddings (
  session_id TEXT PRIMARY KEY,
  embedding vector(384) NOT NULL,
  FOREIGN KEY(session_id) REFERENCES session_summaries(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_summary_embeddings_hnsw_cosine
  ON session_summary_embeddings USING hnsw (embedding vector_cosine_ops);

UPDATE conversations
SET sequence_id = subquery.new_seq
FROM (
  SELECT id, row_number() OVER (ORDER BY timestamp ASC, id ASC) AS new_seq
  FROM conversations
) AS subquery
WHERE conversations.id = subquery.id
  AND conversations.sequence_id IS NULL;

CREATE SEQUENCE IF NOT EXISTS conversations_seq;

SELECT setval(
  'conversations_seq',
  GREATEST(COALESCE((SELECT MAX(sequence_id) FROM conversations), 0) + 1, 1),
  false
);

ALTER TABLE conversations ALTER COLUMN sequence_id SET DEFAULT nextval('conversations_seq');
ALTER TABLE conversations ALTER COLUMN sequence_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_sequence ON conversations(sequence_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session_id_sequence_id ON conversations(session_id, sequence_id);

-- Ensure the self-reference uses ON DELETE SET NULL.
DO $constraints$
DECLARE
  constraint_name TEXT;
  delete_rule TEXT;
BEGIN
  SELECT tc.constraint_name, rc.delete_rule
    INTO constraint_name, delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
   AND tc.constraint_schema = rc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'conversations'
    AND kcu.column_name = 'related_message_id'
  LIMIT 1;

  IF constraint_name IS NOT NULL AND delete_rule <> 'SET NULL' THEN
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', constraint_name);
    EXECUTE format(
      'ALTER TABLE conversations ADD CONSTRAINT %I FOREIGN KEY (related_message_id) REFERENCES conversations(id) ON DELETE SET NULL',
      constraint_name
    );
  ELSIF constraint_name IS NULL THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_related_message_id_fkey
      FOREIGN KEY (related_message_id)
      REFERENCES conversations(id)
      ON DELETE SET NULL;
  END IF;
END
$constraints$;

-- Ensure the session-summary embedding FK uses ON DELETE CASCADE.
DO $summary_fk$
DECLARE
  constraint_name TEXT;
  delete_rule TEXT;
BEGIN
  SELECT tc.constraint_name, rc.delete_rule
    INTO constraint_name, delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
   AND tc.constraint_schema = rc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'session_summary_embeddings'
    AND kcu.column_name = 'session_id'
  LIMIT 1;

  IF constraint_name IS NOT NULL AND delete_rule <> 'CASCADE' THEN
    EXECUTE format('ALTER TABLE session_summary_embeddings DROP CONSTRAINT %I', constraint_name);
    EXECUTE format(
      'ALTER TABLE session_summary_embeddings ADD CONSTRAINT %I FOREIGN KEY (session_id) REFERENCES session_summaries(session_id) ON DELETE CASCADE',
      constraint_name
    );
  ELSIF constraint_name IS NULL THEN
    ALTER TABLE session_summary_embeddings
      ADD CONSTRAINT session_summary_embeddings_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES session_summaries(session_id)
      ON DELETE CASCADE;
  END IF;
END
$summary_fk$;
