// tests/zzz-teardown.js
// Global teardown: close DB after all tests have finished
const { db } = require('./test-helper');

after(async () => {
  try {
    await db.close();
    console.log('Global teardown: database connections closed cleanly.');
  } catch (err) {
    console.error('Error closing database in global teardown:', err.message);
  }
});
