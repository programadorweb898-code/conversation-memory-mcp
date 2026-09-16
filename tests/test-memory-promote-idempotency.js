const { expect } = require('chai');
const sinon = require('sinon');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

function resetMemoryModules() {
  delete require.cache[require.resolve('../src/tools/memoryPromote')];
}

describe('Memory Promote idempotency', function () {
  this.timeout(15000);

  const owner = 'test';
  const project = 'idempotency-test';
  const sessions = [];
  let memoryPromote;
  let adapter;

  beforeEach(() => {
    resetMemoryModules();

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'integration-test' }),
      promote: sinon.stub().resolves({
        success: true,
        memoryId: 'engram-idempotent-1',
        topicKey: 'decisions/postgres',
      }),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    memoryPromote = require('../src/tools/memoryPromote');
  });

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessions) {
      await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1 AND project = $2 AND owner = $3', [
        sessionId,
        project,
        owner,
      ]);
    }
    sessions.length = 0;
  });

  async function seedCandidate() {
    const sessionId = `promote-idempotency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const candidateId = `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.push(sessionId);

    await db.runAsync(
      `INSERT INTO memory_candidates (
        id, project, session_id, agent_id, type, title, content, topic_key,
        what, why, where_context, learned, importance, status, source_message_ids, owner
      ) VALUES (
        $1, $2, $3, NULL, 'decision', 'usar postgres', 'PostgreSQL para historial',
        'decisions/postgres', 'usar PostgreSQL', 'persistencia durable',
        'conversation-memory-mcp', 'separar historial de memoria técnica',
        'high', 'missing', '[]'::jsonb, $4
      )`,
      [candidateId, project, sessionId, owner]
    );

    return { sessionId, candidateId };
  }

  it('promover dos veces el mismo candidato llama al adaptador una sola vez', async () => {
    const { sessionId, candidateId } = await seedCandidate();

    const first = await memoryPromote({
      sessionId,
      project,
      candidateIds: [candidateId],
      owner,
    });

    expect(first.results[0]).to.deep.equal({
      candidateId,
      status: 'promoted',
      memoryId: 'engram-idempotent-1',
    });
    expect(adapter.promote.calledOnce).to.equal(true);
    expect(adapter.promote.firstCall.args[1]).to.deep.equal({ idempotencyKey: candidateId });

    const second = await memoryPromote({
      sessionId,
      project,
      candidateIds: [candidateId],
      owner,
    });

    expect(second.results[0]).to.deep.equal({
      candidateId,
      status: 'already_promoted',
      memoryId: 'engram-idempotent-1',
    });
    expect(adapter.promote.calledOnce).to.equal(true);

    const row = await db.getAsync(
      `SELECT status, promoted_at, engram_id, engram_topic_key
       FROM memory_candidates
       WHERE id = $1`,
      [candidateId]
    );

    expect(row.status).to.equal('missing');
    expect(row.promoted_at).to.not.equal(null);
    expect(row.engram_id).to.equal('engram-idempotent-1');
    expect(row.engram_topic_key).to.equal('decisions/postgres');
  });
});
