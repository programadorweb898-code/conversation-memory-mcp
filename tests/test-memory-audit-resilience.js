const { expect } = require('chai');
const sinon = require('sinon');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

const memoryAuditPath = require.resolve('../src/tools/memoryAudit');
const extractMemoriesPath = require.resolve('../src/tools/extractMemories');

function loadMemoryAuditWithExtraction(extraction) {
  delete require.cache[memoryAuditPath];
  delete require.cache[extractMemoriesPath];
  require.cache[extractMemoriesPath] = {
    id: extractMemoriesPath,
    filename: extractMemoriesPath,
    loaded: true,
    exports: sinon.stub().resolves(extraction),
  };
  return require('../src/tools/memoryAudit');
}

function candidate() {
  return {
    type: 'decision',
    title: 'Usar PostgreSQL para el historial',
    what: 'PostgreSQL para almacenar el historial',
    why: 'Necesitamos persistencia',
    whereContext: 'conversation-memory-mcp',
    learned: '',
    importance: 'high',
    sourceMessageIds: ['msg-1'],
  };
}

describe('Memory Audit resilience', function () {
  this.timeout(10000);

  const project = `memory-audit-resilience-${Date.now()}`;
  const sessionId = `resilience-${Date.now()}`;
  let adapter;

  afterEach(async () => {
    sinon.restore();
    delete require.cache[memoryAuditPath];
    delete require.cache[extractMemoriesPath];
    await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1', [sessionId]);
  });

  it('returns a controlled result for a session that does not exist', async () => {
    const memoryAudit = loadMemoryAuditWithExtraction({
      sessionExists: false,
      messageCount: 0,
      messages: [],
      candidates: [],
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local' }),
      searchRelated: sinon.stub(),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    const result = await memoryAudit({ sessionId, project, agentId: 'test-agent' });

    expect(result.sessionExists).to.equal(false);
    expect(result.candidates).to.deep.equal([]);
    expect(memoryAdapterService.getMemoryAdapter.called).to.equal(false);
  });

  it('marks candidates as pending when the durable memory provider is unavailable', async () => {
    const memoryAudit = loadMemoryAuditWithExtraction({
      sessionExists: true,
      messageCount: 1,
      messages: [{ id: 'msg-1' }],
      candidates: [candidate()],
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({
        available: false,
        provider: 'engram-local',
        error: 'Engram no está disponible',
      }),
      searchRelated: sinon.stub(),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    const result = await memoryAudit({ sessionId, project, agentId: 'test-agent' });

    expect(result.memoryProvider.available).to.equal(false);
    expect(result.candidates).to.have.lengthOf(1);
    expect(result.candidates[0].status).to.equal('pending');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(adapter.searchRelated.called).to.equal(false);
  });

  it('marks candidates as pending when the durable memory search fails', async () => {
    const memoryAudit = loadMemoryAuditWithExtraction({
      sessionExists: true,
      messageCount: 1,
      messages: [{ id: 'msg-1' }],
      candidates: [candidate()],
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local' }),
      searchRelated: sinon.stub().rejects(new Error('fallo de conexión')),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    const result = await memoryAudit({ sessionId, project, agentId: 'test-agent' });

    expect(result.candidates[0].status).to.equal('pending');
    expect(result.candidates[0].reason).to.include('fallo de conexión');
    expect(result.candidates[0].promotable).to.equal(false);
  });

  it('falls back to the heuristic decision when the LLM response is invalid', async () => {
    const memoryAudit = loadMemoryAuditWithExtraction({
      sessionExists: true,
      messageCount: 1,
      messages: [{ id: 'msg-1' }],
      candidates: [candidate()],
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local' }),
      searchRelated: sinon.stub().resolves([]),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);
    sinon.stub(llmClient, 'generateText').resolves('{"status":"invalid"}');

    const result = await memoryAudit({ sessionId, project, agentId: 'test-agent' });

    expect(result.candidates[0].status).to.equal('missing');
    expect(result.candidates[0].promotable).to.equal(true);
    expect(adapter.searchRelated.calledOnce).to.equal(true);
  });
});
