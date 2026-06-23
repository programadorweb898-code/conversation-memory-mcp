const { expect } = require('chai');
const sinon = require('sinon');
const getLastSessionContext = require('../src/tools/getLastSessionContext');
const lastSession = require('../src/tools/lastSession');

describe('Fallback to Engram', () => {
  let lastSessionStub;

  beforeEach(() => {
    lastSessionStub = sinon.stub(lastSession, 'lastSession');
  });

  afterEach(() => {
    lastSessionStub.restore();
  });

  it('should signal Engram fallback when DB connection fails', async () => {
    lastSessionStub.rejects(new Error('DB_CONNECTION_FAILURE'));

    const context = await getLastSessionContext();
    
    expect(context.sessionId).to.equal('ENGRAM_FALLBACK_REQUIRED');
    expect(context.summary).to.contain('Error de conexión');
  });
});
