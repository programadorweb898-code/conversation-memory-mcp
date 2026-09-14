const { expect } = require('chai');
const sinon = require('sinon');

const { db } = require('./test-helper');
const saveMessage = require('../src/tools/saveMessage');
const searchMessages = require('../src/tools/searchMessages');
const recoverSession = require('../src/tools/recoverSession');
const listSessions = require('../src/tools/listSessions');
const lastSession = require('../src/tools/lastSession');
const deleteSession = require('../src/tools/deleteSession');
const { withScope } = require('../src/mcpTools');
const { runWithAuth } = require('../src/context');

const PROJECT = 'owner-isolation-test';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

describe('Aislamiento por owner', () => {
  const createdSessions = [];

  function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function cleanup() {
    for (const sessionId of createdSessions) {
      try {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
        await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error('Error en limpieza de owner-isolation:', err.message);
      }
    }
    createdSessions.length = 0;
  }

  beforeEach(() => {
    sinon.stub(require('../src/services/embeddingQueue'), 'addTask').returns();
  });

  afterEach(async () => {
    sinon.restore();
    await cleanup();
  });

  it('asigna el owner provisto y persiste un mensaje sin NULL', async () => {
    const sessionId = uniqueId('mis');
    createdSessions.push(sessionId);

    await saveMessage({ sessionId, project: PROJECT, role: 'user', content: 'hola owner-a', owner: OWNER_A });

    const row = await db.getAsync(
      `SELECT owner FROM conversations WHERE session_id = $1 AND project = $2`,
      [sessionId, PROJECT]
    );
    expect(row).to.exist;
    expect(row.owner).to.equal(OWNER_A);
  });

  it('para datos sin owner autenticado usa el dueño por defecto (no NULL)', async () => {
    const sessionId = uniqueId('default');
    createdSessions.push(sessionId);

    await saveMessage({ sessionId, project: PROJECT, role: 'user', content: 'sin auth' });

    const row = await db.getAsync(
      `SELECT owner FROM conversations WHERE session_id = $1 AND project = $2`,
      [sessionId, PROJECT]
    );
    expect(row).to.exist;
    expect(row.owner).to.be.a('string').and.not.empty;
  });

  it('searchMessages devuelve solo los mensajes del owner', async () => {
    const sessionA = uniqueId('sA');
    const sessionB = uniqueId('sB');
    createdSessions.push(sessionA, sessionB);

    await saveMessage({ sessionId: sessionA, project: PROJECT, role: 'user', content: 'secreto unico alfa', owner: OWNER_A });
    await saveMessage({ sessionId: sessionB, project: PROJECT, role: 'user', content: 'secreto unico beta', owner: OWNER_B });

    const forA = await searchMessages({ project: PROJECT, searchTerm: 'secreto unico', owner: OWNER_A });
    expect(forA.map((r) => r.content)).to.include('secreto unico alfa');
    expect(forA.map((r) => r.content)).to.not.include('secreto unico beta');

    const all = await searchMessages({ project: PROJECT, searchTerm: 'secreto unico' });
    expect(all.map((r) => r.content)).to.include('secreto unico alfa');
    expect(all.map((r) => r.content)).to.include('secreto unico beta');
  });

  it('recoverSession, listSessions y lastSession respetan el owner', async () => {
    const sessionA = uniqueId('rA');
    const sessionB = uniqueId('rB');
    createdSessions.push(sessionA, sessionB);

    await saveMessage({ sessionId: sessionA, project: PROJECT, role: 'user', content: 'contenido de A', owner: OWNER_A });
    await saveMessage({ sessionId: sessionB, project: PROJECT, role: 'user', content: 'contenido de B', owner: OWNER_B });

    const recoveredB = await recoverSession({ sessionId: sessionB, project: PROJECT, owner: OWNER_B });
    expect(recoveredB.map((r) => r.content)).to.include('contenido de B');
    expect(recoveredB.map((r) => r.content)).to.not.include('contenido de A');

    const recoveredAOfSessionB = await recoverSession({ sessionId: sessionB, project: PROJECT, owner: OWNER_A });
    expect(recoveredAOfSessionB).to.have.lengthOf(0);

    const sessionsA = await listSessions({ project: PROJECT, owner: OWNER_A });
    const idsA = sessionsA.map((s) => s.session_id);
    expect(idsA).to.include(sessionA);
    expect(idsA).to.not.include(sessionB);

    const lastA = await lastSession({ project: PROJECT, owner: OWNER_B });
    expect(lastA).to.equal(sessionB);
  });

  it('rechaza escribir en una sesión existente de otro owner (OWNER_CONFLICT)', async () => {
    const sessionA = uniqueId('conflict');
    createdSessions.push(sessionA);

    await saveMessage({ sessionId: sessionA, project: PROJECT, role: 'user', content: 'de A', owner: OWNER_A });

    let error = null;
    try {
      await saveMessage({ sessionId: sessionA, project: PROJECT, role: 'user', content: 'intento de B', owner: OWNER_B });
    } catch (err) {
      error = err;
    }
    expect(error).to.exist;
    expect(error.code).to.equal('OWNER_CONFLICT');

    const rows = await db.allAsync(`SELECT content FROM conversations WHERE session_id = $1`, [sessionA]);
    expect(rows.map((r) => r.content)).to.not.include('intento de B');
  });

  it('deleteSession solo elimina la sesión del owner pedido', async () => {
    const sessionA = uniqueId('dA');
    const sessionB = uniqueId('dB');
    createdSessions.push(sessionA, sessionB);

    await saveMessage({ sessionId: sessionA, project: PROJECT, role: 'user', content: 'mensaje A', owner: OWNER_A });
    await saveMessage({ sessionId: sessionB, project: PROJECT, role: 'user', content: 'mensaje B', owner: OWNER_B });

    await deleteSession({ sessionId: sessionA, project: PROJECT, owner: OWNER_A });

    const remainingA = await db.getAsync(`SELECT id FROM conversations WHERE session_id = $1`, [sessionA]);
    const remainingB = await db.getAsync(`SELECT id FROM conversations WHERE session_id = $1`, [sessionB]);
    expect(remainingA).to.be.undefined;
    expect(remainingB).to.exist;
  });

  describe('withScope (no-spoofeo del owner)', () => {
    it('el owner del contexto HTTP prevalece sobre el owner enviado en el request', () => {
      const scoped = runWithAuth({ scope: PROJECT, master: false, owner: OWNER_A, apiKeyId: 'k1' }, () =>
        withScope({ project: PROJECT, owner: 'owner-malicioso', searchTerm: 'x' })
      );
      expect(scoped.owner).to.equal(OWNER_A);
    });

    it('sin contexto de auth no inyecta owner (admin/modp stdio: sin filtro)', () => {
      const scoped = withScope({ project: PROJECT, searchTerm: 'x' });
      expect(scoped).to.not.have.property('owner');
    });

    it('admin (owner null) no lleva owner en los parámetros', () => {
      const scoped = runWithAuth({ scope: null, master: true, owner: null, apiKeyId: null }, () =>
        withScope({ project: PROJECT, searchTerm: 'x' })
      );
      expect(scoped).to.not.have.property('owner');
    });
  });
});