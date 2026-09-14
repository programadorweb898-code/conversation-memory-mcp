-- La Neon real tenía `importance` como float4, pero el código y el modelo
-- de datos lo tratan como enum de texto (low|medium|high). Se convierte a TEXT.
DO $importance_text$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'importance'
      AND data_type IN ('real', 'double precision', 'numeric', 'smallint', 'integer', 'bigint')
  ) THEN
    ALTER TABLE memory_candidates ALTER COLUMN importance TYPE TEXT USING importance::text;
  END IF;
END
$importance_text$;