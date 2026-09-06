-- Baseline migration for conversation-memory-mcp.
-- This migration defines the core schema expected by the current application.
-- It is intentionally additive/idempotent so it can establish the baseline
-- without deleting existing production data.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  project TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_project
  ON conversations(project);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id
  ON conversations(session_id);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  summary TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_processed_seq_id BIGINT
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_project
  ON session_summaries(project);

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

CREATE INDEX IF NOT EXISTS idx_memory_candidates_project
  ON memory_candidates(project);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_session_id
  ON memory_candidates(session_id);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
  ON memory_candidates(status);

CREATE TABLE IF NOT EXISTS conversations_seq_placeholder (
  _placeholder BOOLEAN PRIMARY KEY DEFAULT TRUE
);

DROP TABLE IF EXISTS conversations_seq_placeholder;
