const { expect } = require('chai');
const lastSession = require("../src/tools/lastSession");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Last Session Tool', () => {
  const project = `last-session-${Date.now()}`;
  const sessionIds = [];

  afterEach(async () => {
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(
          'DELETE FROM conversations WHERE session_id = $1 AND project = $2',
          [sessionId, project]
        );
      } catch (err) {
        console.error('Error en limpieza de test-last-session:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  it('debería recuperar la última sesión creada', async () => {
    const testSessionId = `session-${Date.now()}`;
    sessionIds.push(testSessionId);

    await saveMessage({
      sessionId: testSessionId,
      project,
      role: "user",
      content: "Test para lastSession"
    });

    const result = await lastSession({ project });
    expect(result).to.equal(testSessionId);
  });

  it('debería recuperar la última sesión creada filtrada por agentId', async () => {
    const sessionId1 = `session-1-${Date.now()}`;
    const sessionId2 = `session-2-${Date.now()}`;
    sessionIds.push(sessionId1, sessionId2);
    const agentId = 'agent-1';

    await saveMessage({ sessionId: sessionId1, project, role: 'user', content: 'M1', agentId });
    await saveMessage({ sessionId: sessionId2, project, role: 'user', content: 'M2', agentId: 'other-agent' });

    const result = await lastSession({ project, agentId });
    expect(result).to.equal(sessionId1);
  });
});
