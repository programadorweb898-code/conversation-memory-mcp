// tests/00-global-setup.js
// Se ejecuta antes que cualquier otro archivo de test (orden alfabético: "00-" < "test-").
// Garantiza que el esquema esté actualizado antes de correr queries contra Postgres.
//
// Los tests corren contra un schema separado (por defecto `cm_test`) dentro de la
// MISMA base. Sin esto, cada `npm test` escribe fixtures en el schema `public`,
// que es el que usan las conversaciones reales: los tests ensucian la memoria y
// además disparan el summarizer del LLM sobre datos basura.
const { Pool } = require('pg');
const { runMigrations } = require('../scripts/migrate');

// This test-only fallback reuses the developer's configured PostgreSQL URL,
// while isolating every test object in cm_test before application modules load.
process.env.CONVERSATION_MEMORY_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.CONVERSATION_MEMORY_DATABASE_URL || process.env.DATABASE_URL || '';

const TEST_SCHEMA = process.env.TEST_SCHEMA || 'cm_test';

// Estas dos variables tienen que quedar listas ANTES del `before`, no durante.
// Mocha carga todos los archivos de test antes de ejecutar cualquier hook, así
// que `src/database.js` ya crea su pool con lo que haya en este punto. Si se
// ajusta acá adentro, el pool queda apuntando a `public` y los tests vuelven a
// escribir en el schema de producción sin que nada lo delate.
process.env.PG_SEARCH_PATH = TEST_SCHEMA;
// Los tests no pasan por el pooler de Neon. No porque el pooler_descarte
// transacciones (no se pudo demostrar: 0 pérdidas en 9 configuraciones de
// concurrencia), sino porque para una base compartida con datos reales conviene
// no sumar una capa de proxy que reescribe el protocolo entre el cliente y la
// base, y porque el endpoint directo es el que documenta .env.example. Si algún
// día la suite pasa por el pooler, esta línea se puede quitar: el aislamiento por
// schema no depende de ella.
process.env.CONVERSATION_MEMORY_DATABASE_URL = process.env.CONVERSATION_MEMORY_DATABASE_URL.replace('-pooler.', '.');

async function ensureSchema() {
  if (!process.env.CONVERSATION_MEMORY_DATABASE_URL) {
    throw new Error('CONVERSATION_MEMORY_DATABASE_URL is required to run the test suite.');
  }

  const bootstrap = new Pool({ connectionString: process.env.CONVERSATION_MEMORY_DATABASE_URL });
  try {
    const client = await bootstrap.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
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
