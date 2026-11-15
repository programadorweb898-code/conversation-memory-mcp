const { expect } = require('chai');
const { db, withTransaction, withAdvisoryLock } = require('../src/database');
const { v4: uuidv4 } = require('uuid');

describe('Database transactions', () => {
  it('keeps schema and timeout on the backend executing each concurrent transaction', async () => {
    const { getConfig } = require('../src/config');
    const expected = getConfig().database;
    const sql = `SELECT current_schema() AS schema,
      extract(epoch FROM current_setting('statement_timeout')::interval) * 1000 AS timeout_ms`;
    const readSettings = async () => {
      const ordinary = await db.getAsync(sql);
      const transaction = await withTransaction((tx) => tx.getAsync(sql));
      const locked = await withAdvisoryLock(uuidv4(), async (client) => {
        const result = await client.query(sql);
        return result.rows[0];
      });
      return [ordinary, transaction, locked];
    };
    const results = await Promise.all(Array.from({ length: 12 }, readSettings));
    for (const row of results.flat()) {
      expect(row.schema).to.equal(expected.searchPath);
      expect(Number(row.timeout_ms)).to.equal(expected.queryTimeoutMs);
    }
  });

  it('should rollback all writes when a transaction fails', async () => {
    const id = uuidv4();
    const project = `transaction-test-${Date.now()}`;
    const originalContent = 'original';

    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content)
       VALUES ($1, $2, $3, 'user', $4)`,
      [id, `session-${id}`, project, originalContent]
    );

    try {
      let error;
      try {
        await withTransaction(async (tx) => {
          await tx.runAsync(
            'UPDATE conversations SET content = $1 WHERE id = $2',
            ['changed-inside-transaction', id]
          );

          throw new Error('forced rollback');
        });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an('Error');
      expect(error.message).to.equal('forced rollback');

      const row = await db.getAsync(
        'SELECT content FROM conversations WHERE id = $1',
        [id]
      );

      expect(row.content).to.equal(originalContent);
    } finally {
      await db.runAsync('DELETE FROM conversations WHERE id = $1', [id]);
    }
  });
});
