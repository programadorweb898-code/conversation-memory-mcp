const { expect } = require('chai');
const sinon = require('sinon');
const Module = require('module');

const migrate = require('../scripts/migrate');
const createMcp = require('../src/createMcpServer');
const embeddingWorker = require('../src/services/embeddingWorker');
const realStdioSdk = require('@modelcontextprotocol/sdk/server/stdio.js');

function resetStdioModule() {
  delete require.cache[require.resolve('../src/stdio')];
}

function loadStdioWithDependencies({ runMigrations, createMcpServer, startWorker, StdioServerTransport }) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../scripts/migrate' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { ...migrate, runMigrations };
    }

    if (request === './createMcpServer' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { ...createMcp, createMcpServer };
    }

    if (request === './services/embeddingWorker' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { ...embeddingWorker, startWorker, stopWorker: embeddingWorker.stopWorker };
    }

    if (request === '@modelcontextprotocol/sdk/server/stdio.js') {
      return { ...realStdioSdk, StdioServerTransport };
    }

    return originalLoad.apply(this, arguments);
  };

  resetStdioModule();
  try {
    return require('../src/stdio');
  } finally {
    Module._load = originalLoad;
  }
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
    process.env.DATABASE_URL = '';
    const fatalExit = new Error('process.exit called');
    const exitStub = sinon.stub(process, 'exit').callsFake(() => {
      throw fatalExit;
    });
    const errorStub = sinon.stub(console, 'error');

    const { startStdioServer } = loadStdioWithDependencies({
      runMigrations: sinon.stub(),
      createMcpServer: sinon.stub(),
      startWorker: sinon.stub(),
      StdioServerTransport: sinon.stub(),
    });

    let thrownError;
    try {
      await startStdioServer();
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).to.equal(fatalExit);
    expect(exitStub.calledWith(1)).to.be.true;
    expect(errorStub.calledWith('Fatal error: DATABASE_URL environment variable is required.')).to.be.true;
  });

  it('should run migrations, connect MCP over stdio and start embeddings worker by default', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.ENABLE_EMBEDDING_WORKER = 'true';

    const runMigrationsStub = sinon.stub().resolves();
    const connectStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub });
    const transport = { start: sinon.stub().resolves() };
    const transportConstructorStub = sinon.stub().returns(transport);
    const startWorkerStub = sinon.stub();

    const { startStdioServer } = loadStdioWithDependencies({
      runMigrations: runMigrationsStub,
      createMcpServer: createMcpServerStub,
      startWorker: startWorkerStub,
      StdioServerTransport: transportConstructorStub,
    });

    await startStdioServer();

    expect(runMigrationsStub.calledOnce).to.be.true;
    expect(runMigrationsStub.firstCall.args[0].logger.log).to.be.a('function');
    expect(runMigrationsStub.firstCall.args[0].logger.error).to.be.a('function');
    expect(createMcpServerStub.calledOnce).to.be.true;
    expect(transportConstructorStub.calledOnce).to.be.true;
    expect(connectStub.calledOnceWithExactly(transport)).to.be.true;
    expect(startWorkerStub.calledOnce).to.be.true;
  });

  it('should skip the embeddings worker when explicitly disabled', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.ENABLE_EMBEDDING_WORKER = 'false';

    const runMigrationsStub = sinon.stub().resolves();
    const connectStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub });
    const transport = { start: sinon.stub().resolves() };
    const transportConstructorStub = sinon.stub().returns(transport);
    const startWorkerStub = sinon.stub();

    const { startStdioServer } = loadStdioWithDependencies({
      runMigrations: runMigrationsStub,
      createMcpServer: createMcpServerStub,
      startWorker: startWorkerStub,
      StdioServerTransport: transportConstructorStub,
    });

    await startStdioServer();

    expect(connectStub.calledOnceWithExactly(transport)).to.be.true;
    expect(startWorkerStub.called).to.be.false;
  });
});
