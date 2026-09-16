-- Completa tablas embedding_failures creadas antes de que existiera el contador.
ALTER TABLE embedding_failures
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;