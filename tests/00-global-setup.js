// tests/00-global-setup.js
// Se ejecuta antes que cualquier otro archivo de test (orden alfabético: "00-" < "test-").
// Garantiza que las tablas ya existan en Postgres antes de correr queries contra ellas.
const { dbReady } = require('./test-helper');
process.env.MCP_BEARER_TOKEN = 'test-token';
before(async function () {
  this.timeout(20000);
  await dbReady;
});
