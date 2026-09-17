const { expect } = require('chai');
const { loadMigrations, runMigrations } = require('../scripts/migrate');
const { db } = require('./test-helper');

describe('Migration runner idempotency', function () {
  this.timeout(30000);

  it('runMigrations is idempotent and schema_migrations matches the migration files', async () => {
    await runMigrations({ logger: { log() {}, error() {} } });

    const firstRows = await db.allAsync(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
    );

    await runMigrations({ logger: { log() {}, error() {} } });

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
    expect(migrations.map(({ version }) => version)).to.deep.equal(
      firstRows.map(({ version }) => version)
    );
  });
});
