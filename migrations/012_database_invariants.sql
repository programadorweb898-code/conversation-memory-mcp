-- Database-level invariants that protect data integrity even when writes
-- bypass the application layer.

DO $preflight$
DECLARE
  invalid_projects BIGINT;
  mixed_sessions BIGINT;
BEGIN
  SELECT count(*) INTO invalid_projects
  FROM conversations
  WHERE project IS NULL OR btrim(project) = '';

  IF invalid_projects > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce conversation project invariant: % conversation rows have NULL/blank project',
      invalid_projects;
  END IF;

  SELECT count(*) INTO invalid_projects
  FROM session_summaries
  WHERE project IS NULL OR btrim(project) = '';

  IF invalid_projects > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce summary project invariant: % summary rows have NULL/blank project',
      invalid_projects;
  END IF;

  SELECT count(*) INTO mixed_sessions
  FROM (
    SELECT session_id, owner
    FROM conversations
    GROUP BY session_id, owner
    HAVING count(DISTINCT project) > 1
  ) sessions;

  IF mixed_sessions > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce session project invariant: % sessions contain multiple projects',
      mixed_sessions;
  END IF;

  SELECT count(*) INTO mixed_sessions
  FROM session_summaries ss
  WHERE EXISTS (
    SELECT 1
    FROM conversations c
    WHERE c.session_id = ss.session_id
      AND c.owner = ss.owner
      AND c.project <> ss.project
  );

  IF mixed_sessions > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce summary project invariant: % summaries disagree with their conversation project',
      mixed_sessions;
  END IF;

  SELECT count(*) INTO mixed_sessions
  FROM conversations c
  WHERE c.related_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM conversations related
      WHERE related.id = c.related_message_id
        AND related.session_id = c.session_id
        AND related.owner = c.owner
    );

  IF mixed_sessions > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce related_message_id invariant: % references point to another session/owner or a missing message',
      mixed_sessions;
  END IF;
END
$preflight$;

ALTER TABLE conversations
  ALTER COLUMN project SET NOT NULL;

ALTER TABLE session_summaries
  ALTER COLUMN project SET NOT NULL;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_project_not_blank;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_project_not_blank
  CHECK (btrim(project) <> '');

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_session_id_not_blank;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_session_id_not_blank
  CHECK (btrim(session_id) <> '');

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_id_not_blank;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_id_not_blank
  CHECK (btrim(id) <> '');

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_owner_not_blank;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_owner_not_blank
  CHECK (btrim(owner) <> '');

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_content_not_blank;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_content_not_blank
  CHECK (btrim(content) <> '');

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_role_allowed;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_role_allowed
  CHECK (role IN ('user', 'assistant', 'system'));

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_project_not_blank;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_project_not_blank
  CHECK (btrim(project) <> '');

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_session_id_not_blank;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_session_id_not_blank
  CHECK (btrim(session_id) <> '');

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_owner_not_blank;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_owner_not_blank
  CHECK (btrim(owner) <> '');

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_summary_not_blank;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_summary_not_blank
  CHECK (btrim(summary) <> '');

ALTER TABLE session_summaries
  DROP CONSTRAINT IF EXISTS session_summaries_watermark_nonnegative;

ALTER TABLE session_summaries
  ADD CONSTRAINT session_summaries_watermark_nonnegative
  CHECK (last_processed_seq_id IS NULL OR last_processed_seq_id >= 0);

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_related_message_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_id_session_owner
  ON conversations(id, session_id, owner);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_related_message_same_session_fkey
  FOREIGN KEY (related_message_id, session_id, owner)
  REFERENCES conversations(id, session_id, owner)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION enforce_session_project_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    IF EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.session_id = NEW.session_id
        AND c.owner = NEW.owner
        AND c.project <> NEW.project
        AND c.id IS DISTINCT FROM NEW.id
    ) OR EXISTS (
      SELECT 1
      FROM session_summaries ss
      WHERE ss.session_id = NEW.session_id
        AND ss.owner = NEW.owner
        AND ss.project <> NEW.project
    ) THEN
      RAISE EXCEPTION
        'Session % for owner % cannot use project % because another record uses a different project',
        NEW.session_id, NEW.owner, NEW.project
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.session_id = NEW.session_id
        AND c.owner = NEW.owner
        AND c.project <> NEW.project
    ) OR EXISTS (
      SELECT 1
      FROM session_summaries ss
      WHERE ss.session_id = NEW.session_id
        AND ss.owner = NEW.owner
        AND ss.project <> NEW.project
        AND (ss.session_id, ss.owner) IS DISTINCT FROM (NEW.session_id, NEW.owner)
    ) THEN
      RAISE EXCEPTION
        'Session % for owner % cannot use project % because another record uses a different project',
        NEW.session_id, NEW.owner, NEW.project
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS conversations_session_project_consistency
  ON conversations;

CREATE CONSTRAINT TRIGGER conversations_session_project_consistency
AFTER INSERT OR UPDATE OF session_id, owner, project
ON conversations
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_session_project_consistency();

DROP TRIGGER IF EXISTS session_summaries_session_project_consistency
  ON session_summaries;

CREATE CONSTRAINT TRIGGER session_summaries_session_project_consistency
AFTER INSERT OR UPDATE OF session_id, owner, project
ON session_summaries
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_session_project_consistency();
