/*
  Tests de criterios de exito de memoryAudit (T1-T12).
  Se usan sesiones reales en Neon, el LLM se stubea (prompt de extraccion vs
  prompt de auditoria, detectado por el marcador ASCII "JSON AUDIT") y el
  adaptador de memoria es un mock, para que las pruebas sean deterministas y no
  dependan de Engram ni de la quota de Gemini.
*/
const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const saveMessage = require('../src/tools/saveMessage');
const memoryAudit = require('../src/tools/memoryAudit');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

// Marcador del prompt de auditoria (tambien es distinto del prompt de extraccion).
const AUDIT_MARKER = 'JSON AUDIT';

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY;
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'test-key';
}

function setApiKey() {
  process.env.GEMINI_API_KEY = 'test-key';
}

function clearApiKey() {
  delete process.env.GEMINI_API_KEY;
}

function restoreApiKey() {
  if (DEFAULT_API_KEY !== undefined) {
    process.env.GEMINI_API_KEY = DEFAULT_API_KEY;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
}

function stubSmartLlm({ candidates, verdict }) {
  const generateContent = sinon.stub().callsFake((prompt) => {
    const isAudit = String(prompt).includes(AUDIT_MARKER);
    const payload = isAudit ? verdict : { candidates };
    return { response: { text: () => JSON.stringify(payload) } };
  });
  sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({ generateContent });
  return generateContent;
}

function mockAdapter({ status = { available: true, provider: 'engram-local', version: '0.1.0' }, related = [], searchError = null } = {}) {
  const getStatus = sinon.stub().resolves(status);
  const searchRelated = searchError
    ? sinon.stub().rejects(new Error(searchError))
    : sinon.stub().resolves(related);
  return { provider: 'engram-local', getStatus, searchRelated };
}

function stubAdapter(adapter) {
  sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);
}

describe('Memory Audit Tool', function () {
  this.timeout(15000);
  const sessionIds = [];

  function makeCandidate(id, overrides = {}) {
    return {
      type: 'decision',
      title: 'decidimos usar postgres en neon para el historial',
      what: 'postgres en neon',
      why: '',
      whereContext: '',
      learned: '',
      importance: 'high',
      sourceMessageIds: ['msg-' + id],
      ...overrides,
    };
  }

  async function seed(pairs) {
    const sessionId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIds.push(sessionId);
    const ids = [];
    for (const [role, content] of pairs) {
      const res = await saveMessage({ sessionId, project: 'test', role, content });
      if (res.messageId) ids.push(res.messageId);
    }
    return { sessionId, ids };
  }

  function count(sql, params) {
    return db.getAsync(sql, params).then((row) => Number(row.c));
  }

  afterEach(async () => {
    sinon.restore();
    restoreApiKey();
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(`DELETE FROM memory_candidates WHERE session_id = $1`, [sessionId]);
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM embedding_failures WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error('Error en limpieza de test-memory-audit:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  it('T1 — estructura del resultado con proveedor, sesion y candidato auditado (missing)', async () => {
    const { sessionId, ids } = await seed([['user', 'Decidimos usar Postgres en Neon para el historial.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    stubAdapter(mockAdapter({ related: [] }));
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.sessionId).to.equal(sessionId);
    expect(result.project).to.equal('test');
    expect(result.agentId).to.equal(null);
    expect(result.sessionExists).to.equal(true);
    expect(result.messageCount).to.equal(1);
    expect(result.memoryProvider).to.deep.include({ available: true, provider: 'engram-local' });
    expect(result.memoryProvider.version).to.equal('0.1.0');
    expect(result.candidates).to.have.lengthOf(1);
    const c = result.candidates[0];
    expect(c).to.have.property('candidateId').that.is.a('string');
    expect(c.status).to.equal('missing');
    expect(c.relatedMemories).to.deep.equal([]);
    expect(c.promotable).to.equal(true);
    expect(c.reason).to.be.a('string').that.is.not.empty;
  });

  it('T2 — already_exists por heuristica cuando el proveedor devuelve una memoria equivalente', async () => {
    const { sessionId, ids } = await seed([['user', 'Decidimos usar Postgres en Neon para el historial.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    const adapter = mockAdapter({
      related: [{
        id: 'obs-1', topicKey: null, type: 'decision',
        title: 'decidimos usar postgres en neon para el historial',
        content: 'postgres en neon',
      }],
    });
    stubAdapter(adapter);
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('already_exists');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(result.candidates[0].relatedMemories[0].id).to.equal('obs-1');
    expect(adapter.getStatus.calledOnce).to.equal(true);
    expect(adapter.searchRelated.calledOnce).to.equal(true);
    const query = adapter.searchRelated.getCall(0).args[0];
    expect(query.project).to.equal('test');
    expect(query.limit).to.equal(5);
    expect(query.query).to.include('postgres');
  });

  it('T3 — missing cuando no hay memorias relacionadas', async () => {
    const { sessionId, ids } = await seed([['user', 'Decidimos usar Postgres en Neon para el historial.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    stubAdapter(mockAdapter({ related: [] }));
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('missing');
    expect(result.candidates[0].promotable).to.equal(true);
    expect(result.candidates[0].relatedMemories).to.deep.equal([]);
  });

  it('T4 — related cuando el solapamiento es bajo pero no nulo', async () => {
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({
      candidates: [{
        type: 'decision', title: 'a b c d e f', what: '', why: '',
        whereContext: '', learned: '', importance: 'low',
        sourceMessageIds: ['msg-' + ids[0]],
      }],
    });
    stubAdapter(mockAdapter({
      related: [{ id: 'obs-3', topicKey: null, type: 'configuration', title: 'c d', content: 'g h i j k l m n' }],
    }));
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('related');
    expect(result.candidates[0].promotable).to.equal(false);
  });

  it('T5 — possible_duplicate cuando el solapamiento es alto pero no equivalente', async () => {
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({
      candidates: [{
        type: 'decision', title: 'a b c d e f', what: '', why: '',
        whereContext: '', learned: '', importance: 'low',
        sourceMessageIds: ['msg-' + ids[0]],
      }],
    });
    stubAdapter(mockAdapter({
      related: [{ id: 'obs-4', topicKey: null, type: 'discovery', title: 'c d e f', content: 'g h i j k l' }],
    }));
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('possible_duplicate');
    expect(result.candidates[0].promotable).to.equal(false);
  });

  it('T6 — pending cuando el proveedor no esta disponible (sin consulta de busqueda)', async () => {
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    const adapter = mockAdapter({
      status: { available: false, provider: 'engram-local', error: 'connection refused' },
    });
    stubAdapter(adapter);
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.memoryProvider.available).to.equal(false);
    expect(result.candidates[0].status).to.equal('pending');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(result.candidates[0].reason).to.include('connection refused');
    expect(adapter.searchRelated.called).to.equal(false);
    const row = await db.getAsync(
      'SELECT status FROM memory_candidates WHERE session_id = $1',
      [sessionId]
    );
    expect(row.status).to.equal('pending');
  });

  it('T6b — pending si el proveedor responde pero la busqueda falla', async () => {
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    stubAdapter(mockAdapter({ related: [], searchError: 'ECONNREFUSED' }));
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('pending');
    expect(result.candidates[0].reason).to.contain('ECONNREFUSED');
  });

  it('T7 — idempotente: re-auditar la misma sesion no duplica filas en memory_candidates', async function () {
    this.timeout(15000);
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    stubAdapter(mockAdapter({ related: [] }));
    clearApiKey();

    const first = await memoryAudit({ sessionId, project: 'test' });
    const second = await memoryAudit({ sessionId, project: 'test' });

    const candidateId = first.candidates[0].candidateId;
    expect(second.candidates[0].candidateId).to.equal(candidateId);
    expect(second.candidates[0].status).to.equal(first.candidates[0].status);
    const rows = await count(
      'SELECT COUNT(*) AS c FROM memory_candidates WHERE id = $1 AND session_id = $2',
      [candidateId, sessionId]
    );
    expect(rows).to.equal(1);
  });

  it('T8 — discard cuando los sourceMessageIds no son trazables', async () => {
    const { sessionId } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({ candidates: [makeCandidate('id-inventado-que-no-existe')] });
    const adapter = mockAdapter({ related: [] });
    stubAdapter(adapter);
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('discard');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(adapter.searchRelated.called).to.equal(false);
  });

  it('T9 — conflict decidido por LLM con relatedMemoryIds trazadas', async () => {
    const { sessionId, ids } = await seed([['user', 'Cambiamos de Postgres a SQLite.']]);
    const generateContent = stubSmartLlm({
      candidates: [makeCandidate(ids[0])],
      verdict: {
        status: 'conflict',
        reason: 'Contradice la decision de usar Postgres en Neon',
        relatedMemoryIds: ['obs-1'],
      },
    });
    stubAdapter(mockAdapter({
      related: [{ id: 'obs-1', topicKey: null, type: 'decision', title: 'usar postgres', content: 'decidimos usar postgres' }],
    }));
    setApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('conflict');
    expect(result.candidates[0].promotable).to.equal(false);
    expect(result.candidates[0].relatedMemories).to.deep.equal([{ id: 'obs-1', topicKey: null }]);
    const auditCalls = generateContent.getCalls().filter((call) => String(call.args[0]).includes(AUDIT_MARKER));
    expect(auditCalls).to.have.lengthOf(1);
    expect(String(auditCalls[0].args[0])).to.include('JSON AUDIT');
  });

  it('T9b — un veredicto LLM invalido degrada a heuristica (missing)', async () => {
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({
      candidates: [makeCandidate(ids[0])],
      verdict: { status: 'estado-invalido', reason: 'x', relatedMemoryIds: [] },
    });
    stubAdapter(mockAdapter({ related: [] }));
    setApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.candidates[0].status).to.equal('missing');
  });

  it('T10 — solo lectura hacia el proveedor: persiste unicamente en Neon', async function () {
    this.timeout(15000);
    const { sessionId, ids } = await seed([['user', 'Mensaje de contexto.']]);
    stubSmartLlm({ candidates: [makeCandidate(ids[0])] });
    const adapter = mockAdapter({ related: [] });
    stubAdapter(adapter);
    clearApiKey();

    const beforeConversations = await count('SELECT COUNT(*) AS c FROM conversations WHERE session_id = $1', [sessionId]);
    const beforeEmbeddings = await count(
      'SELECT COUNT(*) AS c FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
      [sessionId]
    );
    const beforeSummaries = await count('SELECT COUNT(*) AS c FROM session_summaries WHERE session_id = $1', [sessionId]);

    await memoryAudit({ sessionId, project: 'test' });

    const afterConversations = await count('SELECT COUNT(*) AS c FROM conversations WHERE session_id = $1', [sessionId]);
    const afterEmbeddings = await count(
      'SELECT COUNT(*) AS c FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
      [sessionId]
    );
    const afterSummaries = await count('SELECT COUNT(*) AS c FROM session_summaries WHERE session_id = $1', [sessionId]);
    const candidates = await count('SELECT COUNT(*) AS c FROM memory_candidates WHERE session_id = $1', [sessionId]);

    // La auditoria no toca conversaciones/embeddings/resumenes: solo agrega filas
    // su candidato a memory_candidates (persistencia local de la auditoria).
    expect(afterConversations).to.equal(beforeConversations);
    expect(afterEmbeddings).to.equal(beforeEmbeddings);
    expect(afterSummaries).to.equal(beforeSummaries);
    expect(candidates).to.equal(1);
    // Las unicas operaciones expuestas por el adaptador son de lectura.
    const methods = Object.keys(adapter).filter((k) => typeof adapter[k] === 'function');
    expect(methods.sort()).to.deep.equal(['getStatus', 'searchRelated']);
  });

  it('T12 — sesion inexistente devuelve respuesta controlada sin consultar el proveedor', async () => {
    const sessionId = `audit-inexistente-${Date.now()}`;
    const adapter = mockAdapter({ related: [] });
    stubAdapter(adapter);
    stubSmartLlm({ candidates: [], verdict: { status: 'missing', reason: 'x', relatedMemoryIds: [] } });
    clearApiKey();

    const result = await memoryAudit({ sessionId, project: 'test' });

    expect(result.sessionExists).to.equal(false);
    expect(result.messageCount).to.equal(0);
    expect(result.candidates).to.deep.equal([]);
    expect(result.memoryProvider).to.equal(null);
    expect(adapter.getStatus.called).to.equal(false);
    expect(adapter.searchRelated.called).to.equal(false);
  });
});