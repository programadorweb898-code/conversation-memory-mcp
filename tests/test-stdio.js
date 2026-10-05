const { expect } = require('chai');
const sinon = require('sinon');
const Module = require('module');
const { EventEmitter } = require('events');

const createMcp = require('../src/createMcpServer');
const embeddingWorker = require('../src/services/embeddingWorker');
const realStdioSdk = require('@modelcontextprotocol/sdk/server/stdio.js');

function resetStdioModule() {
  delete require.cache[require.resolve('../src/stdio')];
}

function loadStdioWithDependencies({
  createMcpServer,
  startWorker,
  stopWorker,
  StdioServerTransport,
  databaseDb,
}) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './createMcpServer' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { ...createMcp, createMcpServer };
    }

    if (request === './services/embeddingWorker' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { ...embeddingWorker, startWorker, stopWorker: stopWorker || embeddingWorker.stopWorker };
    }

    if (request === './database' && parent?.filename?.endsWith(`${require('path').sep}src${require('path').sep}stdio.js`)) {
      return { db: databaseDb };
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

function createProcessRef() {
  const processRef = new EventEmitter();
  processRef.stdin = new EventEmitter();
  processRef.exit = sinon.stub();
  return processRef;
}

describe('stdio server', () => {
  let originalMemoryDatabaseUrl;
  let originalWorkerSetting;
  let processRef;
  let databaseDb;

  beforeEach(() => {
    resetStdioModule();
    originalMemoryDatabaseUrl = process.env.CONVERSATION_MEMORY_DATABASE_URL;
    originalWorkerSetting = process.env.ENABLE_EMBEDDING_WORKER;
    processRef = createProcessRef();
    databaseDb = { close: sinon.stub().resolves() };
  });

  afterEach(() => {
    sinon.restore();
    resetStdioModule();

    if (originalMemoryDatabaseUrl === undefined) delete process.env.CONVERSATION_MEMORY_DATABASE_URL;
    else process.env.CONVERSATION_MEMORY_DATABASE_URL = originalMemoryDatabaseUrl;

    if (originalWorkerSetting === undefined) delete process.env.ENABLE_EMBEDDING_WORKER;
    else process.env.ENABLE_EMBEDDING_WORKER = originalWorkerSetting;
  });

  it('should fail fast when CONVERSATION_MEMORY_DATABASE_URL is missing', async () => {
    process.env.CONVERSATION_MEMORY_DATABASE_URL = '';
    const fatalExit = new Error('process.exit called');
    const exitStub = sinon.stub(process, 'exit').callsFake(() => {
      throw fatalExit;
    });
    const errorStub = sinon.stub(console, 'error');

    const { startStdioServer } = loadStdioWithDependencies({
      createMcpServer: sinon.stub(),
      startWorker: sinon.stub(),
      StdioServerTransport: sinon.stub(),
      databaseDb,
    });

    let thrownError;
    try {
      await startStdioServer();
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).to.equal(fatalExit);
    expect(exitStub.calledWith(1)).to.be.true;
    expect(errorStub.calledWith('Fatal error: CONVERSATION_MEMORY_DATABASE_URL environment variable is required. Run `conversation-memory-mcp install` first.')).to.be.true;
  });

  it('should connect over stdio and start embeddings worker without running migrations', async () => {
    process.env.CONVERSATION_MEMORY_DATABASE_URL = 'postgresql://test';
    process.env.ENABLE_EMBEDDING_WORKER = 'true';

    const connectStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub });
    const transport = { start: sinon.stub().resolves() };
    const transportConstructorStub = sinon.stub().returns(transport);
    const startWorkerStub = sinon.stub();

    const { startStdioServer } = loadStdioWithDependencies({
      createMcpServer: createMcpServerStub,
      startWorker: startWorkerStub,
      StdioServerTransport: transportConstructorStub,
      databaseDb,
    });

    await startStdioServer({ processRef });

    expect(createMcpServerStub.calledOnce).to.be.true;
    expect(transportConstructorStub.calledOnce).to.be.true;
    expect(connectStub.calledOnceWithExactly(transport)).to.be.true;
    expect(startWorkerStub.calledOnce).to.be.true;
  });

  it('should skip the embeddings worker when explicitly disabled', async () => {
    process.env.CONVERSATION_MEMORY_DATABASE_URL = 'postgresql://test';
    process.env.ENABLE_EMBEDDING_WORKER = 'false';

    const connectStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub });
    const transport = { start: sinon.stub().resolves() };
    const transportConstructorStub = sinon.stub().returns(transport);
    const startWorkerStub = sinon.stub();

    const { startStdioServer } = loadStdioWithDependencies({
      createMcpServer: createMcpServerStub,
      startWorker: startWorkerStub,
      StdioServerTransport: transportConstructorStub,
      databaseDb,
    });

    await startStdioServer({ processRef });

    expect(connectStub.calledOnceWithExactly(transport)).to.be.true;
    expect(startWorkerStub.called).to.be.false;
  });

  it('closes the worker, MCP server and database when stdin reaches EOF', async () => {
    process.env.CONVERSATION_MEMORY_DATABASE_URL = 'postgresql://test';
    const connectStub = sinon.stub().resolves();
    const serverCloseStub = sinon.stub().resolves();
    const stopWorkerStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub, close: serverCloseStub });
    const transportConstructorStub = sinon.stub().returns({});
    const startWorkerStub = sinon.stub();

    const { startStdioServer } = loadStdioWithDependencies({
      createMcpServer: createMcpServerStub,
      startWorker: startWorkerStub,
      stopWorker: stopWorkerStub,
      StdioServerTransport: transportConstructorStub,
      databaseDb,
    });

    const lifecycle = await startStdioServer({ processRef });
    processRef.stdin.emit('end');
    processRef.stdin.emit('close');
    await lifecycle.shutdown();

    expect(stopWorkerStub.calledOnce).to.be.true;
    expect(serverCloseStub.calledOnce).to.be.true;
    expect(databaseDb.close.calledOnce).to.be.true;
    expect(processRef.exit.calledOnceWithExactly(0)).to.be.true;
  });

  it('closes resources and exits with a signal status on SIGTERM', async () => {
    process.env.CONVERSATION_MEMORY_DATABASE_URL = 'postgresql://test';
    const connectStub = sinon.stub().resolves();
    const serverCloseStub = sinon.stub().resolves();
    const stopWorkerStub = sinon.stub().resolves();
    const createMcpServerStub = sinon.stub().returns({ connect: connectStub, close: serverCloseStub });
    const transportConstructorStub = sinon.stub().returns({});

    const { startStdioServer } = loadStdioWithDependencies({
      createMcpServer: createMcpServerStub,
      startWorker: sinon.stub(),
      stopWorker: stopWorkerStub,
      StdioServerTransport: transportConstructorStub,
      databaseDb,
    });

    const lifecycle = await startStdioServer({ processRef });
    processRef.emit('SIGTERM');
    await lifecycle.shutdown();

    expect(stopWorkerStub.calledOnce).to.be.true;
    expect(serverCloseStub.calledOnce).to.be.true;
    expect(databaseDb.close.calledOnce).to.be.true;
    expect(processRef.exit.calledOnceWithExactly(143)).to.be.true;
  });
});
