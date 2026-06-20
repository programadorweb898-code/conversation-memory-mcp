// tests/zzz-teardown.js
// Global teardown: close DB after all tests have finished
const { db } = require('../src/database');

after(function(done) {
  db.close((err) => {
    if (err) console.error('Error closing database in global teardown:', err.message);
    else console.log('Global teardown: database closed.');
    done();
  });
});
