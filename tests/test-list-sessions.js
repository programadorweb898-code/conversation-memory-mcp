const { expect } = require('chai');
const listSessions = require("../src/tools/listSessions");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('List Sessions Tool', () => {
  const project = `list-sessions-${Date.now()}`;
  const sessionIds = [];

  afterEach(async () => {
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(
          'DELETE FROM conversations WHERE session_id = $1 AND project = $2',
          [sessionId, project]
        );
      } catch (err) {
        console.error('Error en limpieza de test-list-sessions:', err.message);
      }
    }
    sessionIds.length = 0;
  });

  it('debería listar todas las sesiones disponibles', async () => {
    const sessionId1 = `session-1-${Date.now()}`;
    const sessionId2 = `session-2-${Date.now()}`;
    sessionIds.push(sessionId1, sessionId2);

    await saveMessage({ sessionId: sessionId1, project, role: "user", content: "M1" });
    await saveMessage({ sessionId: sessionId2, project, role: "user", content: "M2" });

    const sessions = await listSessions({ project });

    // Verificamos que al menos nuestras dos sesiones estén en la lista
    const listedSessionIds = sessions.map(s => s.session_id);
    expect(listedSessionIds).to.include(sessionId1);
    expect(listedSessionIds).to.include(sessionId2);
  });

  it('debería listar sesiones filtradas por agentId', async () => {
    const sessionId1 = `session-1-${Date.now()}`;
    const sessionId2 = `session-2-${Date.now()}`;
    sessionIds.push(sessionId1, sessionId2);
    const agentId = 'agent-1';

    await saveMessage({ sessionId: sessionId1, project, role: "user", content: "M1", agentId });
    await saveMessage({ sessionId: sessionId2, project, role: "user", content: "M2", agentId: 'other-agent' });

    const sessions = await listSessions({ project, agentId });

    // Verificamos que solo la sesión del agente esté en la lista
    const listedSessionIds = sessions.map(s => s.session_id);
    expect(listedSessionIds).to.include(sessionId1);
    expect(listedSessionIds).to.not.include(sessionId2);
  });
});
