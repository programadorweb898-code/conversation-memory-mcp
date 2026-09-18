-- El Neon real tiene una columna legacy `error TEXT NOT NULL` en
-- embedding_failures, creada por un esquema anterior que no está en 001 ni en
-- el código (que solo usa last_error). Al insertar una fila nueva, el NOT NULL
-- de `error` hacía fallar el INSERT. Se elimina la columna para alinear el
-- esquema con 001. Es idempotente: no-op si la columna no existe.
ALTER TABLE embedding_failures DROP COLUMN IF EXISTS error;
