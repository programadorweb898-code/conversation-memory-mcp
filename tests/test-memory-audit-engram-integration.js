const { expect } = require('chai');
const sinon = require('sinon');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const saveMessage = require('../src/tools/saveMessage');
const { db } = require('./test-helper');

function resetMemoryModules() {
  delete require.cache[require.resolve('../src/tools/memoryAudit')];
  delete require.cache[require.resolve('../src/tools/extractMemories')];
  delete require.cache[require.resolve('../src/tools/memoryPromote')];
}

describe('Memory Audit -> Engram promotion contract', function () {
  this.timeout(15000);

  const sessions = [];
  let memoryAudit;
  let memoryPromote;
  let adapter;
  let candidate;
  let sourceMessageId;

  beforeEach(async () => {
    resetMemoryModules();

    sourceMessageId = null;
    candidate = {
      type: 'decision',
      title: 'usar postgres para el historial',
      what: 'PostgreSQL para persistir el historial',
      why: 'Necesitamos persistencia durable',
      whereContext: 'conversation-memory-mcp',
      learned: 'mantener el historial separado de la memoria tecnica',
      importance: 'high',
      sourceMessageIds: [],
    };

    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      if (String(prompt).includes('JSON AUDIT')) {
        return JSON.stringify({
          status: 'missing',
          reason: 'No existe una memoria durable equivalente.',
          relatedMemoryIds: [],
        });
      }

      return JSON.stringify({
        candidates: [{ ...candidate, sourceMessageIds: sourceMessageId ? [sourceMessageId] : [] }],
      });
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'integration-test' }),
      searchRelated: sinon.stub().resolves([]),
      promote: sinon.stub().resolves({ success: true, memoryId: 'engram-101', topicKey: 'decisions/postgres' }),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    memoryAudit = require('../src/tools/memoryAudit');
    memoryPromote = require('../src/tools/memoryPromote');
  });

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessions) {
      try {
        await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1', [sessionId]);
        await db.runAsync(
          'DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
          [sessionId]
        );
        await db.runAsync(
          'DELETE FROM embedding_failures WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
          [sessionId]
        );
        await db.runAsync('DELETE FROM conversations WHERE session_id = $1', [sessionId]);
      } catch (err) {
        console.error('Error en limpieza de test-memory-audit-engram-integration:', err.message);
      }
    }
    sessions.length = 0;
  });

  async function seed() {
    const sessionId = `audit-engram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.push(sessionId);
    const saved = await saveMessage({
      sessionId,
      project: 'integration-test',
      role: 'user',
      content: 'Decidimos usar PostgreSQL para persistir el historial.',
    });
    sourceMessageId = saved.messageId;
    return sessionId;
  }

  async function candidateRow(sessionId) {
    return db.getAsync(
      'SELECT id, status, promoted_at, engram_id, engram_topic_key FROM memory_candidates WHERE session_id = $1',
      [sessionId]
    );
  }

  it('missing -> memoryPromote -> adapter.promote, sin que memoryAudit escriba en Engram', async () => {
    const sessionId = await seed();

    const audit = await memoryAudit({ sessionId, project: 'integration-test' });

    expect(audit.candidates[0].status).to.equal('missing');
    expect(audit.candidates[0].promotable).to.equal(true);
    expect(adapter.promote.called).to.equal(false);

    const candidateId = audit.candidates[0].candidateId;
    const promotion = await memoryPromote({
      sessionId,
      project: 'integration-test',
      candidateIds: [candidateId],
    });

    expect(promotion.results[0]).to.deep.equal({
      candidateId,
      status: 'promoted',
      memoryId: 'engram-101',
    });
    expect(adapter.promote.calledOnce).to.equal(true);
    expect(adapter.promote.firstCall.args[0].id).to.equal(candidateId);
    expect(adapter.promote.firstCall.args[1]).to.deep.equal({ idempotencyKey: candidateId });

    const row = await candidateRow(sessionId);
    expect(row.status).to.equal('missing');
    expect(row.promoted_at).to.not.equal(null);
    expect(row.engram_id).to.equal('engram-101');
    expect(row.engram_topic_key).to.equal('decisions/postgres');
  });

  it('already_exists -> no promotion is attempted', async () => {
    const sessionId = await seed();
    adapter.searchRelated.resolves([{
      id: 'engram-existing',
      topicKey: 'decisions/postgres',
      type: 'decision',
      title: 'usar postgres para el historial',
      content: 'PostgreSQL para persistir el historial',
    }]);

    const audit = await memoryAudit({ sessionId, project: 'integration-test' });

    expect(audit.candidates[0].status).to.equal('already_exists');
    expect(audit.candidates[0].promotable).to.equal(false);
    expect(adapter.promote.called).to.equal(false);

    const promotion = await memoryPromote({
      sessionId,
      project: 'integration-test',
      candidateIds: [audit.candidates[0].candidateId],
    });

    expect(promotion.results[0].status).to.equal('skipped');
    expect(adapter.promote.called).to.equal(false);
  });

  it('conflict -> queda fuera de promoción y no llama al adaptador de escritura', async () => {
    const sessionId = await seed();
    sinon.restore();

    resetMemoryModules();
    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      if (String(prompt).includes('JSON AUDIT')) {
        return JSON.stringify({
          status: 'conflict',
          reason: 'Contradice una decisión durable existente.',
          relatedMemoryIds: ['engram-existing'],
        });
      }
      return JSON.stringify({ candidates: [{ ...candidate, sourceMessageIds: [sourceMessageId] }] });
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'integration-test' }),
      searchRelated: sinon.stub().resolves([{
        id: 'engram-existing',
        topicKey: 'decisions/postgres',
        type: 'decision',
        title: 'usar sqlite para el historial',
        content: 'La persistencia debe usar SQLite',
      }]),
      promote: sinon.stub().resolves({ success: true, memoryId: 'engram-should-not-exist' }),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);
    memoryAudit = require('../src/tools/memoryAudit');
    memoryPromote = require('../src/tools/memoryPromote');

    const audit = await memoryAudit({ sessionId, project: 'integration-test' });

    expect(audit.candidates[0].status).to.equal('conflict');
    expect(audit.candidates[0].promotable).to.equal(false);
    expect(adapter.promote.called).to.equal(false);

    const promotion = await memoryPromote({
      sessionId,
      project: 'integration-test',
      candidateIds: [audit.candidates[0].candidateId],
    });

    expect(promotion.results[0].status).to.equal('skipped');
    expect(adapter.promote.called).to.equal(false);
  });
});
