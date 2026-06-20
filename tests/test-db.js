const { expect } = require('chai');
const { db, dbReadyPromise } = require('../src/database');

describe('Database Initialization', () => {
  it('debería inicializar correctamente', async () => {
    await dbReadyPromise;
    expect(db).to.not.be.null;
  });

  it('debería tener la columna agent_id en la tabla conversations', async () => {
    await dbReadyPromise;
    const rows = await db.allAsync("PRAGMA table_info(conversations)");
    const agentIdColumn = rows.find(column => column.name === 'agent_id');
    expect(agentIdColumn).to.exist;
    expect(agentIdColumn.type).to.equal('TEXT');
  });
});
