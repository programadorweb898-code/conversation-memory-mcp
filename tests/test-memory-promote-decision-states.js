const { expect } = require('chai');
const sinon = require('sinon');
const memoryPromote = require('../src/tools/memoryPromote');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

const PROVIDER_OK = { available: true, provider: 'engram-local', version: '0.1.0' };

function makeAdapter() {
  return {
    provider: 'engram-local',
    getStatus: sinon.stub().resolves(PROVIDER_OK),
    promote: sinon.stub().resolves({ success: true, memoryId: 'should-not-be-created' }),
  };
}

async function insertCandidate({ id, sessionId, status }) {
  await db.runAsync(
    `INSERT INTO memory_candidates (
      id, project, session_id, type, title, topic_key, what, why, where_context,
      learned, importance, status, source_message_ids, engram_id, engram_topic_key,
      audited_at, promoted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      'test',
      sessionId,
      'decision',
      `candidate ${status}`,
      null,
      'candidate content',
      null,
      null,
      null,
      'high',
      status,
      JSON.stringify(['msg-1']),
      null,
      null,
      new Date().toISOString(),
      null,
    ]
  );
}

describe('Memory Promote — non-promotable audit states', function () {
  this.timeout(15000);
  const sessionIds = [];

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessionIds) {
      await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1', [sessionId]);
    }
    sessionIds.length = 0;
  });

  it('no promueve related, possible_duplicate ni conflict', async () => {
    const sessionId = `decision-states-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIds.push(sessionId);

    const ids = {
      related: `cand-related-${sessionId}`,
      possibleDuplicate: `cand-duplicate-${sessionId}`,
      conflict: `cand-conflict-${sessionId}`,
    };

    await insertCandidate({ id: ids.related, sessionId, status: 'related' });
    await insertCandidate({ id: ids.possibleDuplicate, sessionId, status: 'possible_duplicate' });
    await insertCandidate({ id: ids.conflict, sessionId, status: 'conflict' });

    const adapter = makeAdapter();
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    for (const [status, candidateId] of Object.entries(ids)) {
      const result = await memoryPromote({
        sessionId,
        project: 'test',
        candidateIds: [candidateId],
      });

      expect(result.results[0]).to.deep.include({
        candidateId,
        status: 'skipped',
      });
      expect(result.results[0].reason).to.include(status === 'possibleDuplicate' ? 'possible_duplicate' : status);
    }

    expect(adapter.promote.called).to.equal(false);

    for (const candidateId of Object.values(ids)) {
      const row = await db.getAsync(
        'SELECT status, promoted_at, engram_id, engram_topic_key FROM memory_candidates WHERE id = $1',
        [candidateId]
      );
      expect(row.promoted_at).to.equal(null);
      expect(row.engram_id).to.equal(null);
      expect(row.engram_topic_key).to.equal(null);
    }
  });
});
