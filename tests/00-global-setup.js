// tests/00-global-setup.js
// Se ejecuta antes que cualquier otro archivo de test (orden alfabético: "00-" < "test-").
// Garantiza que el esquema esté actualizado antes de correr queries contra Postgres.
const { runMigrations } = require('../scripts/migrate');
process.env.MCP_BEARER_TOKEN = 'test-token';
process.env.MCP_DEFAULT_OWNER = 'test-owner';
// Fuerza el proveedor Gemini para los tests: los tests que usan LLM lo stubean
// (GoogleGenerativeAI.prototype.getGenerativeModel) y así quedan deterministas.
// En runtime el proveedor se autodetecta desde las keys del .env (OpenRouter).
process.env.AI_PROVIDER = 'gemini';

before(async function () {
  this.timeout(20000);
  await runMigrations();
});
