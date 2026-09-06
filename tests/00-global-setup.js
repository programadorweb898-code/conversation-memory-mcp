// tests/00-global-setup.js
// Se ejecuta antes que cualquier otro archivo de test (orden alfabético: "00-" < "test-").
// Garantiza que el esquema esté actualizado antes de correr queries contra Postgres.
const { runMigrations } = require('../scripts/migrate');
process.env.MCP_BEARER_TOKEN = 'test-token';

before(async function () {
  this.timeout(20000);
  await runMigrations();
});
