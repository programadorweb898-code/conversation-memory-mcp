const { expect } = require('chai');
const { db } = require('./test-helper');
const { loadMigrations } = require('../scripts/migrate');

describe('Database Initialization', () => {
  it('debería inicializar correctamente', async () => {
    expect(db).to.not.be.null;
  }).timeout(10000);

  it('debería tener la columna agent_id en la tabla conversations', async () => {
    const rows = await db.allAsync(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2`, 
      ['conversations', 'agent_id']
    );
    const agentIdColumn = rows.find(column => column.column_name === 'agent_id');
    expect(agentIdColumn).to.exist;
    expect(agentIdColumn.data_type).to.equal('text');
  }).timeout(10000);

  it('debería poder ejecutar dos veces la migración base sin fallar', async () => {
    const migrations = loadMigrations();
    const initialMigration = migrations.find((migration) => migration.version === 1);
    expect(initialMigration).to.exist;

    await db.query(initialMigration.sql);
    await db.query(initialMigration.sql);

    const migrationRecord = await db.getAsync(
      `SELECT version, name FROM schema_migrations WHERE version = $1`,
      [1]
    );
    expect(migrationRecord).to.exist;
    expect(migrationRecord.name).to.equal(initialMigration.name);
  }).timeout(20000);

  it('debería crear de forma idempotente sequence_id y last_processed_seq_id durante el bootstrap', async () => {
    const conversationsColumns = await db.allAsync(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name IN ($2, $3)
    `, ['conversations', 'sequence_id', 'agent_id']);
    const conversationsSequenceColumn = conversationsColumns.find(column => column.column_name === 'sequence_id');
    expect(conversationsSequenceColumn).to.exist;

    const summariesColumns = await db.allAsync(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    `, ['session_summaries', 'last_processed_seq_id']);
    const summariesColumn = summariesColumns.find(column => column.column_name === 'last_processed_seq_id');
    expect(summariesColumn).to.exist;

    const sequenceResult = await db.getAsync(`
      SELECT to_regclass('conversations_seq') AS sequence_name
    `);
    expect(sequenceResult.sequence_name).to.equal('conversations_seq');

    const indexResult = await db.getAsync(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = $1 AND indexname = $2
    `, ['conversations', 'idx_conversations_sequence']);
    expect(indexResult).to.exist;
  }).timeout(10000);
});
