-- Completa bases que ya habían aplicado 006 antes de que existieran estos metadatos.
ALTER TABLE embedding_failures
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE embedding_failures
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
