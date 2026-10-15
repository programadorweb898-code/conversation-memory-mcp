// tests/00-global-setup.js
// Se ejecuta antes que cualquier otro archivo de test (orden alfabético: "00-" < "test-").
// Garantiza que el esquema esté actualizado antes de correr queries contra Postgres.
//
// TEST_DATABASE_URL es obligatoria. Cada ejecución crea un schema cm_test_*
// único; nunca reutiliza ni borra un schema preexistente.
const { testDatabaseTarget } = require('./helpers/test-database-target');
const target = testDatabaseTarget();
process.env.CONVERSATION_MEMORY_DATABASE_URL = target.connectionString;
process.env.PG_SEARCH_PATH = target.schema;
const { Pool } = require('pg');
const { runMigrations } = require('../scripts/migrate');

const TEST_SCHEMA = target.schema;

// Estas dos variables tienen que quedar listas ANTES del `before`, no durante.
// Mocha carga todos los archivos de test antes de ejecutar cualquier hook, así
// que `src/database.js` ya crea su pool con lo que haya en este punto. Si se
// ajusta acá adentro, el pool queda apuntando a `public` y los tests vuelven a
// escribir en el schema de producción sin que nada lo delate.
process.env.PG_SEARCH_PATH = TEST_SCHEMA;

async function ensureSchema() {
  if (!process.env.CONVERSATION_MEMORY_DATABASE_URL) {
    throw new Error('CONVERSATION_MEMORY_DATABASE_URL is required to run the test suite.');
  }

  const bootstrap = new Pool({ connectionString: process.env.CONVERSATION_MEMORY_DATABASE_URL });
  try {
    const client = await bootstrap.connect();
    try {
      // Sin DROP inicial: las ejecuciones simultáneas tienen schemas diferentes.
      await client.query(`CREATE SCHEMA "${TEST_SCHEMA}"`);
    } finally {
      client.release();
    }
  } finally {
    await bootstrap.end();
  }
}

process.env.MCP_BEARER_TOKEN = 'test-token';
process.env.MCP_DEFAULT_OWNER = 'test-owner';
// Fuerza el proveedor Gemini para los tests: los tests que usan LLM lo stubean
// (GoogleGenerativeAI.prototype.getGenerativeModel) y así quedan deterministas.
// En runtime el proveedor se autodetecta desde las keys del .env (OpenRouter).
process.env.AI_PROVIDER = 'gemini';

before(async function () {
  this.timeout(30000);
  await ensureSchema();
  await runMigrations({ confirmed: true });
});

module.exports = { target };

