-- Mantenimiento destructivo para una base antigua dedicada a Conversation Memory.
-- Revisar el destino y respaldarlo antes de ejecutar manualmente.
-- Elimina una columna legacy NOT NULL que no usa el runtime actual.
ALTER TABLE embedding_failures DROP COLUMN IF EXISTS error;