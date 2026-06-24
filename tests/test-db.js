const { expect } = require('chai');
const { db } = require('./test-helper');

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
});
