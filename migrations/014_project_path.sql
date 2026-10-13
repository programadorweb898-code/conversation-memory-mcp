-- Disambiguate projects that share the same short name.
--
-- `project` stays the short, human-readable directory basename used to isolate
-- each project. Because two repositories in different locations can share that
-- basename, `project_path` records the absolute path the turn was saved from,
-- so a collision can be detected after the fact (same project, different path).
--
-- Nullable on purpose: historical rows predate this column and have no path.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS project_path TEXT;

ALTER TABLE session_summaries
  ADD COLUMN IF NOT EXISTS project_path TEXT;

-- Supports collision lookups: same project name reached from different paths.
CREATE INDEX IF NOT EXISTS idx_conversations_project_project_path
  ON conversations(project, project_path);

CREATE INDEX IF NOT EXISTS idx_session_summaries_project_project_path
  ON session_summaries(project, project_path);
