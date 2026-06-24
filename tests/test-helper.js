const { db, dbReady } = require('../src/database');

/**
 * Helper para estandarizar la conexión y operaciones de BD en tests.
 * Ya no requiere dbReadyPromise al estar centralizado.
 */

module.exports = {
  db,
  dbReady
};
