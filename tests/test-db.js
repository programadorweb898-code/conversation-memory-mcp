const { expect } = require('chai');
const db = require('../src/database');

describe('Database Initialization', () => {
  it('debería inicializar correctamente', () => {
    expect(db).to.not.be.null;
  });
});
