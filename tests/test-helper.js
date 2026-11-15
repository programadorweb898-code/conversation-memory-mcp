const { db, withTransaction } = require('../src/database');

/**
 * Helper para estandarizar la conexión y operaciones de BD en tests.
 * Las migraciones se ejecutan explícitamente desde el setup global.
 */

// Cleanup is idempotent. Unlike application writes, these DELETEs may safely
// be repeated once if the test database drops a connection mid-transaction.
async function cleanupMessages({ messageIds = [], sessionIds = [] }) {
  if (!messageIds.length && !sessionIds.length) return;
  const filter = 'id = ANY($1::text[]) OR session_id = ANY($2::text[])';
  const params = [messageIds, sessionIds];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await withTransaction(async (tx) => {
        await tx.runAsync(`DELETE FROM embedding_failures WHERE message_id IN
          (SELECT id FROM conversations WHERE ${filter})`, params);
        await tx.runAsync(`DELETE FROM message_embeddings WHERE message_id IN
          (SELECT id FROM conversations WHERE ${filter})`, params);
        await tx.runAsync(`DELETE FROM conversations WHERE ${filter}`, params);
      });
      return;
    } catch (err) {
      const connectionFailure = String(err.code || '').startsWith('08') ||
        ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03'].includes(err.code) ||
        /Connection terminated|Client has encountered a connection error/i.test(err.message || '');
      if (attempt > 0 || !connectionFailure) throw err;
    }
  }
}

module.exports = { db, cleanupMessages };
