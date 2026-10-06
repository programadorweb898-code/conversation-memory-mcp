const { expect } = require('chai');
const recoverSession = require("../src/tools/recoverSession");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');
const sinon = require('sinon');
const { config } = require('../src/config');

describe('Recover Session Tool', () => {
  const project = `recover-session-${Date.now()}`;
  const sessionIds = [];

  afterEach(async () => {
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(
          'DELETE FROM conversations WHERE session_id = $1 AND project = $2',
          [sessionId, project]
        );
      } catch (err) {
        console.error('Error en limpieza de test-recover-session:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  it('debería recuperar todos los mensajes de una sesión en orden', async () => {
    const sessionId = `test-session-${Date.now()}`;
    sessionIds.push(sessionId);

    await saveMessage({ sessionId, project, role: "user", content: "Mensaje 1" });
    await saveMessage({ sessionId, project, role: "assistant", content: "Mensaje 2" });

    const messages = await recoverSession({ sessionId, project });
    
    expect(messages).to.have.lengthOf(2);
    expect(messages[0].content).to.equal("Mensaje 1");
    expect(messages[1].content).to.equal("Mensaje 2");
  });

  it('debería continuar una sesión desde el cursor sequence_id indicado', async () => {
    const sessionId = `test-session-cursor-${Date.now()}`;
    sessionIds.push(sessionId);

    await saveMessage({ sessionId, project, role: "user", content: "Mensaje 1" });
    await saveMessage({ sessionId, project, role: "assistant", content: "Mensaje 2" });
    await saveMessage({ sessionId, project, role: "user", content: "Mensaje 3" });

    const first = await db.getAsync(
      'SELECT sequence_id FROM conversations WHERE session_id = $1 AND project = $2 ORDER BY sequence_id ASC LIMIT 1',
      [sessionId, project]
    );

    const messages = await recoverSession({
      sessionId,
      project,
      afterSequenceId: first.sequence_id,
      limit: 10,
    });

    expect(messages).to.have.lengthOf(2);
    expect(messages[0].content).to.equal("Mensaje 2");
    expect(messages[1].content).to.equal("Mensaje 3");
    expect(String(messages[0].sequence_id) > String(first.sequence_id)).to.equal(true);
  });

  it('debería recuperar mensajes filtrados por agentId', async () => {
    const sessionId = `test-session-agent-${Date.now()}`;
    sessionIds.push(sessionId);
    const agentId = 'agent-1';
    const otherAgentId = 'agent-2';

    await saveMessage({ sessionId, project, role: "user", content: "Mensaje A1", agentId });
    await saveMessage({ sessionId, project, role: "user", content: "Mensaje A2", agentId: otherAgentId });

    const messages = await recoverSession({ sessionId, project, agentId });
    
    expect(messages).to.have.lengthOf(1);
    expect(messages[0].content).to.equal("Mensaje A1");
    expect(messages[0].agent_id).to.equal(agentId);
  });

  it('debería paginar después de un sequence_id sin alterar el límite máximo', async () => {
    const allAsyncStub = sinon.stub(db, 'allAsync').resolves([]);
    const originalLimit = config.recoverSessionLimit;
    config.recoverSessionLimit = 3;

    try {
      await recoverSession({
        sessionId: 'test-cursor-session',
        project,
        afterSequenceId: '42',
        limit: 2,
      });

      expect(allAsyncStub.calledOnce).to.equal(true);
      const [sql, params] = allAsyncStub.firstCall.args;
      expect(sql).to.include('sequence_id > $3::bigint');
      expect(sql).to.include('ORDER BY sequence_id ASC LIMIT $4');
      expect(params).to.deep.equal(['test-cursor-session', project, '42', 2]);
    } finally {
      config.recoverSessionLimit = originalLimit;
      allAsyncStub.restore();
    }
  });

  it('debería rechazar un cursor que no sea un entero no negativo', async () => {
    try {
      await recoverSession({
        sessionId: 'test-invalid-cursor',
        project,
        afterSequenceId: 'abc',
      });
      throw new Error('Se esperaba un error de validación del cursor');
    } catch (err) {
      expect(err.message).to.equal("El parámetro 'afterSequenceId' debe ser un sequence_id entero no negativo.");
    }
  });

  it('debería limitar la cantidad de mensajes recuperados y respetar el máximo configurado', async () => {
    const allAsyncStub = sinon.stub(db, 'allAsync').resolves([]);
    const originalLimit = config.recoverSessionLimit;
    config.recoverSessionLimit = 3;

    try {
      await recoverSession({
        sessionId: 'test-limited-session',
        project,
        limit: 1000,
      });

      expect(allAsyncStub.calledOnce).to.equal(true);
      const [sql, params] = allAsyncStub.firstCall.args;
      expect(sql).to.include('ORDER BY sequence_id ASC LIMIT $3');
      expect(params).to.deep.equal(['test-limited-session', project, 3]);
    } finally {
      config.recoverSessionLimit = originalLimit;
      allAsyncStub.restore();
    }
  });
});
