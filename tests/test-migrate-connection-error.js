const { expect } = require('chai');

const { runMigrations } = require('../scripts/migrate');

describe('Migration connection errors', function () {
  this.timeout(10000);

  it('prints a connection guide and the original pg error', async () => {
    const previousUrl = process.env.DATABASE_URL;
    const messages = [];

    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@127.0.0.1:1/conversation_memory_test?sslmode=disable';

    try {
      await runMigrations({
        logger: {
          log() {},
          error(...args) {
            messages.push(args);
          },
        },
      });
      throw new Error('Expected runMigrations to reject');
    } catch (error) {
      expect(messages[0][0]).to.equal(
        'No se pudo conectar a la base de datos. Revisá que DATABASE_URL en tu .env sea correcta y que el proyecto de Neon esté activo.'
      );
      expect(messages[1][0]).to.equal(error);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousUrl;
      }
    }
  });
});
