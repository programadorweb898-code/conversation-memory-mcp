const { expect } = require('chai');
const sinon = require('sinon');

const sdk = require('@modelcontextprotocol/sdk/server/stdio.js');
const migrate = require('../scripts/migrate');
const createMcp = require('../src/createMcpServer');
const embeddingWorker = require('../src/services/embeddingWorker');

function resetStdioModule() {
  delete require.cache[require.resolve('../src/stdio')];
}

describe('stdio server', () => {
  let originalDatabaseUrl;
  let originalWorkerSetting;

  beforeEach(() => {
    resetStdioModule();
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalWorkerSetting = process.env.ENABLE_EMBEDDING_WORKER;
  });

  afterEach(() => {
    sinon.restore();
    resetStdioModule();

    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;

    if (originalWorkerSetting === undefined) delete process.env.ENABLE_EMBEDDING_WORKER;
    else process.env.ENABLE_EMBEDDING_WORKER = originalWorkerSetting;
  });

  it('should fail fast when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const exitStub = sinon.stub(process, 'exit').callsFake(() => {});
    const errorStub = sinon.stub(console, 'error');

    const { startStdioServer } = require('../src/stdio');
    await startStdioServer();

    expect(exitStub.calledWith(1)).to.be.true;
    expect(errorStub.calledWith('Fatal error: DATABASE_URL environment variable is required.')).to.be.true;
  });

  it('should run migrations, connect MCP over stdio and start embeddings worker by default', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    delete process.env.ENABLE_EMBEDDING_WORKER;

    const runMigrationsStub = sinon.stub(migrate, 'runMigrations').resolves();
    const createMcpServerStub = sinon.stub(createMcp, 'createMcpServer').returns({
      connect: sinon.stub().resolves(),
    });
    const transport = {};
    sinon.stub(sdk, 'StdioServerTransport').returns(transport);
    const startWorkerStub = sinon.stub(embeddingWorker, 'startWorker');

    const { startStdioServer } = require('../src/stdio');
    await startStdioServer();

    expect(runMigrationsStub.calledOnce).to.be.true;
    expect(runMigrationsStub.firstCall.args[0].logger.log).to.be.a('function');
    expect(runMigrationsStub.firstCall.args[0].logger.error).to.be.a('function');
    expect(createMcpServerStub.calledOnce).to.be.true;
    expect(sdk.StdioServerTransport.calledOnce).to.be.true;
    expect(startWorkerStub.calledOnce).to.be.true;
  });

  it('should skip the embeddings worker when explicitly disabled', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.ENABLE_EMBEDDING_WORKER = 'false';

    sinon.stub(migrate, 'runMigrations').resolves();
    sinon.stub(createMcp, 'createMcpServer').returns({
      connect: sinon.stub().resolves(),
    });
    sinon.stub(sdk, 'StdioServerTransport').returns({});
    const startWorkerStub = sinon.stub(embeddingWorker, 'startWorker');

    const { startStdioServer } = require('../src/stdio');
    await startStdioServer();

    expect(startWorkerStub.called).to.be.false;
  });
});
