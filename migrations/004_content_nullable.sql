-- La Neon real tenía una columna `content` NO NULL que el código de
-- memoryAudit/memoryPromote nunca escribe. Se relaja a nullable para
-- alinear el esquema con el código (001 ya la define como nullable).
DO $content_nullable$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'content'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE memory_candidates ALTER COLUMN content DROP NOT NULL;
  END IF;
END
$content_nullable$;