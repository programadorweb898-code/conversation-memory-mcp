/*
  Tests del criterio de exito de memoryPromote (P1-P12).
  Usa filas reales de memory_candidates en Neon y un adaptador de memoria mock
  (getStatus/promote), para no depender de Engram ni de la CLI.
*/
const { expect } = require('chai');
const sinon = require('sinon');
const memoryPromote = require('../src/tools/memoryPromote');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

const PROVIDER_OK = { available: true, provider: 'engram-local', version: '0.1.0' };

function mockAdapter({ status = PROVIDER_OK, promoteError = null } = {}) {
  const getStatus = sinon.stub().resolves(status);
  const promote = promoteError
    ? sinon.stub().rejects(new Error(promoteError))
    : sinon.stub().resolves({ id: 'obs-101', topicKey: null });
  return { provider: 'engram-local', getStatus, promote };
}

function stubAdapter(adapter) {
  sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);
}

function makeId() {
  lastInsertedId = `cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return lastInsertedId;
}

let lastInsertedId = null;

async function insertCandidate({ id, project, sessionId, type, title, status, topicKey, what, why, whereContext, learned, importance, promotedAt, engramId, engramTopicKey }) {
  await db.runAsync(
    `INSERT INTO memory_candidates (
      id, project, session_id, type, title, topic_key, what, why, where_context,
      learned, importance, status, source_message_ids, engram_id, engram_topic_key,
      audited_at, promoted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      project,
      sessionId,
      type,
      title,
      topicKey,
      what,
      why,
      whereContext,
      learned,
      importance,
      status,
      JSON.stringify(['msg-1']),
      engramId,
      engramTopicKey,
      new Date().toISOString(),
      promotedAt,
    ]
  );
}

describe('Memory Promote Tool', function () {
  this.timeout(15000);
  const sessionIds = [];

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(`DELETE FROM memory_candidates WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error('Error en limpieza de test-memory-promote:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  async function withSession(project = 'test') {
    const sessionId = `promote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIds.push(sessionId);
    return sessionId;
  }

  async function row(id) {
    return db.getAsync(`SELECT * FROM memory_candidates WHERE id = $1`, [id]);
  }

  it('P1 — promoted: crea la memoria vía el adaptador y registra promoted_at/engram_id sin cambiar status', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'decision', title: 'usar postgres', status: 'missing' });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test' });

    expect(result.results).to.have.lengthOf(1);
    expect(result.results[0]).to.deep.equal({ candidateId: id, status: 'promoted', memoryId: 'obs-101' });
    expect(result.memoryProvider).to.deep.include({ available: true, provider: 'engram-local' });
    expect(adapter.promote.calledOnce).to.equal(true);
    const stored = await row(id);
    expect(stored.status).to.equal('missing');
    expect(stored.promoted_at).to.not.equal(null);
    expect(stored.engram_id).to.equal('obs-101');
  });

  it('P2 — already_promoted: no vuelve a crear la memoria', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({
      project: 'test', sessionId, id, type: 'decision', title: 'usar postgres', status: 'missing',
      promotedAt: new Date().toISOString(), engramId: 'obs-9',
    });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test', candidateIds: [id] });

    expect(result.results[0]).to.deep.equal({ candidateId: id, status: 'already_promoted', memoryId: 'obs-9' });
    expect(adapter.promote.called).to.equal(false);
  });

  it('P3 — failed: un error del adaptador no modifica el candidato, queda disponible para reintentar', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'discovery', title: 'gtk4 en windows', status: 'missing' });
    const adapter = mockAdapter({ promoteError: 'el proveedor no responde' });
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test' });

    expect(result.results[0].status).to.equal('failed');
    expect(result.results[0].reason).to.contain('el proveedor no responde');
    expect(result.results[0].memoryId).to.equal(undefined);
    const stored = await row(id);
    expect(stored.status).to.equal('missing');
    expect(stored.promoted_at).to.equal(null);
    expect(stored.engram_id).to.equal(null);
  });

  it('P4 — skipped: un candidato pedido con status no promocionable no se promueve', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'decision', title: 'ya existe', status: 'already_exists' });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test', candidateIds: [id] });

    expect(result.results[0].status).to.equal('skipped');
    expect(result.results[0].reason).to.contain('already_exists');
    expect(adapter.promote.called).to.equal(false);
  });

  it('P5 — not_found: un candidateId inexistente en la sesión/proyecto se reporta sin promover', async () => {
    const sessionId = await withSession();
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test', candidateIds: ['no-existe'] });

    expect(result.results[0]).to.deep.equal({
      candidateId: 'no-existe',
      status: 'not_found',
      reason: 'No existe un candidato auditado con ese id en esta sesión/proyecto.',
    });
    expect(adapter.promote.called).to.equal(false);
  });

  it('P6 — proveedor no disponible: no promueve nada, no toca candidatos y lo informa', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'decision', title: 'usar neon', status: 'missing' });
    const adapter = mockAdapter({ status: { available: false, provider: 'engram-local', error: 'connection refused' } });
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test' });

    expect(result.memoryProvider.available).to.equal(false);
    expect(result.results[0].status).to.equal('failed');
    expect(result.results[0].reason).to.contain('connection refused');
    expect(adapter.promote.called).to.equal(false);
    const stored = await row(id);
    expect(stored.promoted_at).to.equal(null);
    expect(stored.engram_id).to.equal(null);
  });

  it('P7 — sin candidateIds promueve todos los promocionables de la sesión/proyecto', async () => {
    const sessionId = await withSession();
    const idA = makeId();
    const idB = makeId();
    await insertCandidate({ project: 'test', sessionId, id: idA, type: 'decision', title: 'a', status: 'missing' });
    await insertCandidate({ project: 'test', sessionId, id: idB, type: 'lesson', title: 'b', status: 'missing' });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    const result = await memoryPromote({ sessionId, project: 'test' });

    expect(result.results).to.have.lengthOf(2);
    expect(adapter.promote.callCount).to.equal(2);
  });

  it('P8 — idempotente: una segunda ejecución no vuelve a crear la memoria', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'decision', title: 'usar postgres', status: 'missing' });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    await memoryPromote({ sessionId, project: 'test' });
    const second = await memoryPromote({ sessionId, project: 'test' });

    expect(second.results[0]).to.deep.equal({ candidateId: id, status: 'already_promoted', memoryId: 'obs-101' });
    expect(adapter.promote.callCount).to.equal(1);
  });

  it('P9 — el adaptador recibe el candidato normalizado y único por fila', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({
      project: 'test', sessionId, id, type: 'configuration', title: 'cambie temas',
      topicKey: 'config/tema', what: 'usar oscuro', why: 'menos fatiga', whereContext: 'IDE', learned: 'ok',
      status: 'missing',
    });
    const adapter = mockAdapter({});
    stubAdapter(adapter);

    await memoryPromote({ sessionId, project: 'test', candidateIds: [id] });

    const candidate = adapter.promote.getCall(0).args[0];
    expect(candidate.title).to.equal('cambie temas');
    expect(candidate.type).to.equal('configuration');
    expect(candidate.project).to.equal('test');
    expect(candidate.sessionId).to.equal(sessionId);
    expect(candidate.topicKey).to.equal('config/tema');
    expect(candidate.what).to.equal('usar oscuro');
    expect(candidate.why).to.equal('menos fatiga');
    expect(candidate.whereContext).to.equal('IDE');
    expect(candidate.learned).to.equal('ok');
    expect(candidate.sourceMessageIds).to.deep.equal(['msg-1']);
  });

  it('P10 — persiste engram_topic_key devuelto por el adaptador', async () => {
    const sessionId = await withSession();
    const id = makeId();
    await insertCandidate({ project: 'test', sessionId, id, type: 'decision', title: 'usar postgres', status: 'missing' });
    const adapter = mockAdapter({});
    adapter.promote.resolves({ id: 'obs-202', topicKey: 'arquitectura/postgres' });
    stubAdapter(adapter);

    await memoryPromote({ sessionId, project: 'test', candidateIds: [id] });

    const stored = await row(id);
    expect(stored.engram_id).to.equal('obs-202');
    expect(stored.engram_topic_key).to.equal('arquitectura/postgres');
  });

  it('P11 — tipo de resultado global', async () => {
    const sessionId = await withSession();
    stubAdapter(mockAdapter({}));

    const result = await memoryPromote({ sessionId, project: 'test', agentId: 'opencode' });

    expect(result).to.have.property('sessionId', sessionId);
    expect(result).to.have.property('project', 'test');
    expect(result).to.have.property('agentId', 'opencode');
    expect(result.memoryProvider).to.be.a('object');
    expect(result.results).to.be.an('array');
  });

  it('P12 — valida entrada: project obligatorio', async () => {
    let err;
    try {
      await memoryPromote({ sessionId: 's', project: undefined });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error');
    expect(err.message).to.contain('project');
  });
});