const { expect } = require('chai');
const sinon = require('sinon');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

function resetMemoryModules() {
  delete require.cache[require.resolve('../src/tools/memoryPromote')];
}

describe('Memory Promote concurrency', function () {
  this.timeout(15000);

  const owner = 'test';
  const project = 'concurrency-test';
  const sessions = [];
  let memoryPromote;
  let adapter;

  beforeEach(() => {
    resetMemoryModules();

    let releasePromote;
    let promoteStartedResolve;
    const promoteStarted = new Promise((resolve) => {
      promoteStartedResolve = resolve;
    });
    const promoteGate = new Promise((resolve) => {
      releasePromote = resolve;
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'concurrency-test' }),
      promote: sinon.stub().callsFake(async () => {
        promoteStartedResolve();
        await promoteGate;
        return {
          success: true,
          memoryId: 'engram-concurrent-1',
          topicKey: 'decisions/postgres',
        };
      }),
      waitForPromoteStart: () => promoteStarted,
      releasePromote: () => releasePromote(),
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
    const sessionId = `promote-concurrency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  it('dos promociones concurrentes del mismo candidato llaman al adaptador una sola vez', async () => {
    const { sessionId, candidateId } = await seedCandidate();

    const firstPromise = memoryPromote({
      sessionId,
      project,
      candidateIds: [candidateId],
      owner,
    });

    await adapter.waitForPromoteStart();

    const secondPromise = memoryPromote({
      sessionId,
      project,
      candidateIds: [candidateId],
      owner,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter.promote.calledOnce).to.equal(true);

    adapter.releasePromote();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const results = [first.results[0], second.results[0]];

    expect(results).to.have.deep.members([
      {
        candidateId,
        status: 'promoted',
        memoryId: 'engram-concurrent-1',
      },
      {
        candidateId,
        status: 'already_promoted',
        memoryId: 'engram-concurrent-1',
      },
    ]);
    expect(adapter.promote.calledOnce).to.equal(true);

    const row = await db.getAsync(
      `SELECT status, promoted_at, engram_id, engram_topic_key
       FROM memory_candidates
       WHERE id = $1`,
      [candidateId]
    );

    expect(row.status).to.equal('missing');
    expect(row.promoted_at).to.not.equal(null);
    expect(row.engram_id).to.equal('engram-concurrent-1');
    expect(row.engram_topic_key).to.equal('decisions/postgres');
  });
});
