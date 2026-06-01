const { expect } = require('chai');
const listSessions = require("../src/tools/listSessions");
const saveMessage = require("../src/tools/saveMessage");

describe('List Sessions Tool', () => {
  it('debería listar todas las sesiones disponibles', async () => {
    const sessionId1 = `session-1-${Date.now()}`;
    const sessionId2 = `session-2-${Date.now()}`;

    await saveMessage({ sessionId: sessionId1, project: "test", role: "user", content: "M1" });
    await saveMessage({ sessionId: sessionId2, project: "test", role: "user", content: "M2" });

    const sessions = await listSessions();
    
    // Verificamos que al menos nuestras dos sesiones estén en la lista
    const sessionIds = sessions.map(s => s.session_id);
    expect(sessionIds).to.include(sessionId1);
    expect(sessionIds).to.include(sessionId2);
  });
});
