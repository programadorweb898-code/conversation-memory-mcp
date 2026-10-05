-- Mantenimiento del ledger para instalaciones históricas que aplicaron 004/005,
-- cuyos archivos ya no forman parte del producto. No ejecutar automáticamente.
DELETE FROM schema_migrations
WHERE version IN (4, 5);