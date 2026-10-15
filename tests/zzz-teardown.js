// tests/zzz-teardown.js
// Global teardown: close DB after all tests have finished
const { db } = require('./test-helper');
const { Pool } = require('pg');
const { target } = require('./00-global-setup');

after(async () => {
  try {
    await db.close();
    const cleanup = new Pool({ connectionString: target.connectionString });
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS "${target.schema}" CASCADE`);
    } finally {
      await cleanup.end();
    }
    console.log('Global teardown: database connections closed cleanly.');
  } catch (err) {
    console.error('Error closing database in global teardown:', err.message);
  }
});

