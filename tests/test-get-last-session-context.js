const { expect } = require('chai');
const getLastSessionContext = require("../src/tools/getLastSessionContext");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Get Last Session Context Tool', () => {
  const project = `last-session-context-${Date.now()}`;
  const sessionIds = [];

  afterEach(async () => {
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(
          'DELETE FROM conversations WHERE session_id = $1 AND project = $2',
          [sessionId, project]
        );
      } catch (err) {
        console.error('Error en limpieza de test-get-last-session-context:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  it('debería recuperar el contexto completo de la última sesión', async () => {
    const sessionId = `test-session-${Date.now()}`;
    sessionIds.push(sessionId);

    await saveMessage({ sessionId, project, role: "user", content: "Mensaje 1" });

    const context = await getLastSessionContext({ project });
    
    expect(context.sessionId).to.equal(sessionId);
    expect(context.messages).to.have.lengthOf(1);
    expect(context.messages[0].content).to.equal("Mensaje 1");
  });

  it('debería recuperar el contexto filtrado por agentId', async () => {
    const sessionId = `test-session-${Date.now()}`;
    const agentId = 'agent-1';
    sessionIds.push(sessionId);

    await saveMessage({ sessionId, project, role: "user", content: "Mensaje 1", agentId });

    const context = await getLastSessionContext({ project, agentId });
    
    expect(context.sessionId).to.equal(sessionId);
    expect(context.messages).to.have.lengthOf(1);
    expect(context.messages[0].agent_id).to.equal(agentId);
  });
});
