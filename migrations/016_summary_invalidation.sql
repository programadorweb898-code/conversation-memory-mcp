-- A deletion changes the source of every derived summary, even if its maximum
-- sequence_id is unchanged. Keep a revision so in-flight LLM work cannot restore
-- text derived from deleted messages after the invalidation commits.
CREATE TABLE session_revisions (
  session_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, owner)
);

CREATE FUNCTION invalidate_deleted_message_summary()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('summary-source:' || OLD.owner || ':' || OLD.session_id));
  INSERT INTO session_revisions (session_id, owner, revision)
  VALUES (OLD.session_id, OLD.owner, 1)
  ON CONFLICT (session_id, owner) DO UPDATE
    SET revision = session_revisions.revision + 1;
  DELETE FROM session_summaries
    WHERE session_id = OLD.session_id AND owner = OLD.owner;
  RETURN OLD;
END
$fn$;

CREATE TRIGGER conversations_invalidate_summary_on_delete
AFTER DELETE ON conversations
FOR EACH ROW EXECUTE FUNCTION invalidate_deleted_message_summary();
