ALTER TABLE conversations ADD COLUMN source_message_id TEXT;
CREATE UNIQUE INDEX idx_conversations_source_message
  ON conversations(owner, project, session_id, source_message_id)
  WHERE source_message_id IS NOT NULL;
