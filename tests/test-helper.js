const { db } = require('../src/database');

/**
 * Helper para estandarizar la conexión y operaciones de BD en tests.
 * Las migraciones se ejecutan explícitamente desde el setup global.
 */

module.exports = {
  db
};
