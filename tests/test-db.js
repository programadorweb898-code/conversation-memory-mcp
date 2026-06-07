const { expect } = require('chai');
const db = require('../src/database');

describe('Database Initialization', () => {
  it('debería inicializar correctamente', () => {
    expect(db).to.not.be.null;
  });

  it('debería tener la columna agent_id en la tabla conversations', (done) => {
    db.get("PRAGMA table_info(conversations)", (err, row) => {
      if (err) return done(err);
      
      db.all("PRAGMA table_info(conversations)", (err, rows) => {
        if (err) return done(err);

        const agentIdColumn = rows.find(column => column.name === 'agent_id');
        expect(agentIdColumn).to.exist;
        expect(agentIdColumn.type).to.equal('TEXT');
        done();
      });
    });
  });
});
