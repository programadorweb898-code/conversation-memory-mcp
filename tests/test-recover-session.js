const { expect } = require('chai');
const recoverSession = require("../src/tools/recoverSession");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

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
});
