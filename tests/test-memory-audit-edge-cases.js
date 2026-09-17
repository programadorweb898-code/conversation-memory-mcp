const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const saveMessage = require('../src/tools/saveMessage');
const memoryAudit = require('../src/tools/memoryAudit');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

const originalApiKey = process.env.GEMINI_API_KEY;

function candidateFor(messageId, title = 'decidimos usar postgres en neon') {
  return {
    type: 'decision',
    title,
    what: 'usar postgres en neon',
    why: 'persistencia del historial',
    whereContext: 'arquitectura',
    learned: 'mantener el historial persistente',
    importance: 'high',
    sourceMessageIds: [`msg-${messageId}`],
  };
}

function stubAdapter(related = []) {
  const adapter = {
    provider: 'engram-local',
    getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: '0.1.0' }),
    searchRelated: sinon.stub().resolves(related),
  };
  sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);
  return adapter;
}

function stubLlm(sequence) {
  let callIndex = 0;
  const generateContent = sinon.stub().callsFake((prompt) => {
    const result = sequence[callIndex++];
    if (typeof result === 'function') return result(String(prompt));
    return { response: { text: () => result } };
  });
  sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({ generateContent });
  return generateContent;
}

async function seedSession(contents) {
  const sessionId = `audit-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ids = [];
  for (const content of contents) {
    const result = await saveMessage({ sessionId, project: 'test', role: 'user', content });
    ids.push(result.messageId);
  }
  return { sessionId, ids };
}

async function cleanupSession(sessionId) {
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
}

describe('Memory Audit edge cases', function () {
  this.timeout(15000);
  const sessions = [];

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(async () => {
    sinon.restore();
    if (originalApiKey !== undefined) process.env.GEMINI_API_KEY = originalApiKey;
    else delete process.env.GEMINI_API_KEY;

    for (const sessionId of sessions) {
      try {
        await cleanupSession(sessionId);
      } catch (err) {
        console.error('Error en limpieza de test-memory-audit-edge-cases:', err.message);
      }
    }
    sessions.length = 0;
  });

  it('usa la heuristica cuando el LLM de auditoria lanza una excepcion', async () => {
    const { sessionId, ids } = await seedSession(['Decidimos usar Postgres en Neon para el historial.']);
    sessions.push(sessionId);

    const candidate = candidateFor(ids[0]);
    stubLlm([
      JSON.stringify({ candidates: [candidate] }),
      () => { throw new Error('LLM audit unavailable'); },
    ]);
    const adapter = stubAdapter([]);

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates).to.have.lengthOf(1);
    expect(result.candidates[0].status).to.equal('missing');
    expect(result.candidates[0].promotable).to.equal(true);
    expect(adapter.searchRelated.calledOnce).to.equal(true);
  });

  it('usa la heuristica cuando el LLM de auditoria devuelve texto vacio', async () => {
    const { sessionId, ids } = await seedSession(['Decidimos usar Postgres en Neon para el historial.']);
    sessions.push(sessionId);

    const candidate = candidateFor(ids[0]);
    stubLlm([
      JSON.stringify({ candidates: [candidate] }),
      '',
    ]);
    stubAdapter([]);

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('missing');
    expect(result.candidates[0].promotable).to.equal(true);
  });

  it('filtra relatedMemoryIds que no existen entre las memorias consultadas', async () => {
    const { sessionId, ids } = await seedSession(['La decision requiere revision porque esta relacionada con la arquitectura.']);
    sessions.push(sessionId);

    const candidate = candidateFor(ids[0], 'revisar la arquitectura de persistencia');
    stubLlm([
      JSON.stringify({ candidates: [candidate] }),
      JSON.stringify({
        status: 'related',
        reason: 'Existe contexto relacionado',
        relatedMemoryIds: ['memoria-inexistente'],
      }),
    ]);
    const adapter = stubAdapter([
      { id: 'engram-1', topicKey: 'architecture', type: 'decision', title: 'otra decision', content: 'contexto relacionado' },
    ]);

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('related');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(result.candidates[0].relatedMemories).to.deep.equal([]);
    expect(adapter.searchRelated.calledOnce).to.equal(true);
  });

  it('audita y persiste varios candidatos de una misma sesion de forma independiente', async () => {
    const { sessionId, ids } = await seedSession([
      'Decidimos usar Postgres en Neon para el historial.',
      'Decidimos usar Redis para cachear consultas frecuentes.',
    ]);
    sessions.push(sessionId);

    const first = candidateFor(ids[0], 'usar postgres en neon para el historial');
    const second = candidateFor(ids[1], 'usar redis para cachear consultas frecuentes');
    stubLlm([
      JSON.stringify({ candidates: [first, second] }),
      JSON.stringify({ status: 'missing', reason: 'Nueva memoria', relatedMemoryIds: [] }),
      JSON.stringify({ status: 'missing', reason: 'Nueva memoria', relatedMemoryIds: [] }),
    ]);
    const adapter = stubAdapter([]);

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates).to.have.lengthOf(2);
    expect(result.candidates[0].status).to.equal('missing');
    expect(result.candidates[1].status).to.equal('missing');
    expect(result.candidates[0].candidateId).to.not.equal(result.candidates[1].candidateId);
    expect(result.candidates[0].promotable).to.equal(true);
    expect(result.candidates[1].promotable).to.equal(true);
    expect(adapter.searchRelated.callCount).to.equal(2);

    const rowCount = await db.getAsync(
      'SELECT COUNT(*) AS c FROM memory_candidates WHERE session_id = $1',
      [sessionId]
    );
    expect(Number(rowCount.c)).to.equal(2);
  });
});
