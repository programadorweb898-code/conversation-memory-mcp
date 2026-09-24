-- Reconcilia el historial de migraciones con los archivos del repo.
-- migrations/004_content_nullable.sql y migrations/005_importance_text.sql
-- fueron eliminados del repositorio (commits a09011a y 579839b), pero las
-- bases persistentes que los aplicaron conservan sus filas en
-- schema_migrations. Esto rompe la idempotencia: loadMigrations() deja de
-- coincidir con lo registrado en la base.
-- En una base recién creada (CI) no hay filas que eliminar: es un no-op.
DELETE FROM schema_migrations
WHERE version IN (4, 5);