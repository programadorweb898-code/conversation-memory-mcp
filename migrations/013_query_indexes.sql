-- Query indexes for common recovery and search paths.
-- GIN/trigram indexes accelerate the substring ILIKE queries used by the
-- lexical fallback; composite B-tree indexes cover project/owner/session
-- filtering together with sequence/timestamp ordering.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_conversations_session_project_owner_sequence
  ON conversations(session_id, project, owner, sequence_id ASC);

CREATE INDEX IF NOT EXISTS idx_conversations_project_owner_sequence
  ON conversations(project, owner, sequence_id DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_project_owner_agent_session_timestamp
  ON conversations(project, owner, agent_id, session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_content_trgm
  ON conversations USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_session_summaries_project_owner_timestamp
  ON session_summaries(project, owner, timestamp DESC, session_id ASC);

CREATE INDEX IF NOT EXISTS idx_session_summaries_summary_trgm
  ON session_summaries USING gin (summary gin_trgm_ops);
