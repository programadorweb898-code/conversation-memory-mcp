const { expect } = require('chai');
const { loadMigrations, runMigrations } = require('../scripts/migrate');
const { db } = require('./test-helper');

describe('Migration runner idempotency', function () {
  this.timeout(30000);

  it('runMigrations is idempotent and all current migration files are applied', async () => {
    await runMigrations({ confirmed: true, logger: { log() {}, error() {} } });

    const firstRows = await db.allAsync(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
    );

    await runMigrations({ confirmed: true, logger: { log() {}, error() {} } });

    const secondRows = await db.allAsync(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
    );

    expect(secondRows).to.deep.equal(firstRows);

    const duplicateVersions = await db.allAsync(`
      SELECT version
      FROM schema_migrations
      GROUP BY version
      HAVING COUNT(*) > 1
      ORDER BY version
    `);
    expect(duplicateVersions).to.deep.equal([]);

    const migrations = loadMigrations();
    const appliedVersions = new Set(firstRows.map(({ version }) => version));
    expect(migrations.every(({ version }) => appliedVersions.has(version))).to.equal(true);
  });

  it('refuses to run migrations without explicit confirmation', async () => {
    let error;
    try {
      await runMigrations({ logger: { log() {}, error() {} } });
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/confirm the dedicated Conversation Memory database/);
  });
});
