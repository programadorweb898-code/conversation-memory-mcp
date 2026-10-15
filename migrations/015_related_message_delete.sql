-- Keep session and tenant identity when a referenced message is removed.
ALTER TABLE conversations
  DROP CONSTRAINT conversations_related_message_same_session_fkey;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_related_message_same_session_fkey
  FOREIGN KEY (related_message_id, session_id, owner)
  REFERENCES conversations(id, session_id, owner)
  ON DELETE SET NULL (related_message_id);
