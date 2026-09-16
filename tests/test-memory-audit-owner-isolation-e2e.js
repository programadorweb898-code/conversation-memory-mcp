const { expect } = require('chai');
const sinon = require('sinon');
const memoryAudit = require('../src/tools/memoryAudit');
const memoryPromote = require('../src/tools/memoryPromote');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

describe('Memory Audit owner isolation E2E', function () {
  this.timeout(15000);

  const project = `owner-isolation-${Date.now()}`;
  const sessionId = `session-${Date.now()}`;
  const agentId = 'owner-isolation-e2e';
  const ownerA = 'owner-a';
  const ownerB = 'owner-b';
  const messageIdA = '00000000-0000-4000-8000-00000000000a';
  const messageIdB = '00000000-0000-4000-8000-00000000000b';

  const candidateFor = (messageId) => ({
    type: 'decision',
    title: 'Usar PostgreSQL para el historial de conversaciones',
    what: 'PostgreSQL para almacenar el historial',
    why: 'Necesitamos persistencia y recuperación del historial',
    whereContext: 'conversation-memory-mcp',
    learned: 'La persistencia queda centralizada en Neon',
    importance: 'high',
    sourceMessageIds: [`msg-${messageId}`],
  });

  let adapter;
  let activeSourceMessageId;

  beforeEach(async () => {
    activeSourceMessageId = null;

    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      if (String(prompt).includes('JSON AUDIT')) {
        return JSON.stringify({
          status: 'missing',
          reason: 'No existe una memoria durable equivalente.',
          relatedMemoryIds: [],
        });
      }

      return JSON.stringify({
        candidates: [candidateFor(activeSourceMessageId)],
      });
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({
        available: true,
        provider: 'engram-local',
        version: 'e2e-test',
      }),
      searchRelated: sinon.stub().resolves([]),
      promote: sinon.stub().callsFake(async (candidate) => ({
        success: true,
        memoryId: `engram-${candidate.id}`,
        topicKey: 'postgres-history',
      })),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    for (const [owner, messageId] of [[ownerA, messageIdA], [ownerB, messageIdB]]) {
      await db.runAsync(
        `INSERT INTO conversations (id, session_id, project, owner, agent_id, role, content, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          messageId,
          sessionId,
          project,
          owner,
          agentId,
          'user',
          'Decidimos usar PostgreSQL para guardar el historial de conversaciones.',
        ]
      );
    }
  });

  afterEach(async () => {
    sinon.restore();
    await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1 AND project = $2', [sessionId, project]);
    await db.runAsync('DELETE FROM conversations WHERE session_id = $1 AND project = $2', [sessionId, project]);
  });

  it('crea candidatos independientes para owners distintos aunque compartan project y sessionId', async () => {
    activeSourceMessageId = messageIdA;
    const auditA = await memoryAudit({ sessionId, project, agentId, owner: ownerA });

    activeSourceMessageId = messageIdB;
    const auditB = await memoryAudit({ sessionId, project, agentId, owner: ownerB });

    expect(auditA.candidates).to.have.lengthOf(1);
    expect(auditB.candidates).to.have.lengthOf(1);
    expect(auditA.candidates[0].status).to.equal('missing');
    expect(auditB.candidates[0].status).to.equal('missing');
    expect(auditA.candidates[0].candidateId).to.not.equal(auditB.candidates[0].candidateId);

    const rows = await db.allAsync(
      `SELECT id, owner, session_id, project, status
       FROM memory_candidates
       WHERE session_id = $1 AND project = $2
       ORDER BY owner`,
      [sessionId, project]
    );

    expect(rows).to.have.lengthOf(2);
    expect(rows.map((row) => row.owner)).to.deep.equal([ownerA, ownerB]);
    expect(rows.every((row) => row.status === 'missing')).to.equal(true);
  });

  it('mantiene idempotencia por owner y bloquea la promoción cruzada', async () => {
    activeSourceMessageId = messageIdA;
    const auditA1 = await memoryAudit({ sessionId, project, agentId, owner: ownerA });
    const auditA2 = await memoryAudit({ sessionId, project, agentId, owner: ownerA });

    activeSourceMessageId = messageIdB;
    const auditB = await memoryAudit({ sessionId, project, agentId, owner: ownerB });

    const candidateA = auditA1.candidates[0].candidateId;
    const candidateB = auditB.candidates[0].candidateId;

    expect(auditA2.candidates[0].candidateId).to.equal(candidateA);
    expect(candidateA).to.not.equal(candidateB);

    const crossOwner = await memoryPromote({
      sessionId,
      project,
      agentId,
      owner: ownerA,
      candidateIds: [candidateB],
    });

    expect(crossOwner.results).to.deep.equal([{
      candidateId: candidateB,
      status: 'not_found',
      reason: 'No existe un candidato auditado con ese id en esta sesión/proyecto.',
    }]);
    expect(adapter.promote.called).to.equal(false);

    const ownOwner = await memoryPromote({
      sessionId,
      project,
      agentId,
      owner: ownerA,
      candidateIds: [candidateA],
    });

    expect(ownOwner.results).to.deep.equal([{
      candidateId: candidateA,
      status: 'promoted',
      memoryId: `engram-${candidateA}`,
    }]);
    expect(adapter.promote.calledOnce).to.equal(true);

    const rows = await db.allAsync(
      `SELECT owner, promoted_at, engram_id
       FROM memory_candidates
       WHERE session_id = $1 AND project = $2
       ORDER BY owner`,
      [sessionId, project]
    );

    const rowA = rows.find((row) => row.owner === ownerA);
    const rowB = rows.find((row) => row.owner === ownerB);
    expect(rowA.promoted_at).to.not.equal(null);
    expect(rowA.engram_id).to.equal(`engram-${candidateA}`);
    expect(rowB.promoted_at).to.equal(null);
    expect(rowB.engram_id).to.equal(null);
  });
});
