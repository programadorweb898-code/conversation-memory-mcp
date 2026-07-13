const { expect } = require('chai');
const lastSession = require("../src/tools/lastSession");
const saveMessage = require("../src/tools/saveMessage");

describe('Last Session Tool', () => {
  it('debería recuperar la última sesión creada', async () => {
    const testSessionId = `session-${Date.now()}`;
    
    await saveMessage({
      sessionId: testSessionId,
      project: "test",
      role: "user",
      content: "Test para lastSession"
    });

    const result = await lastSession();
    expect(result).to.equal(testSessionId);
  });

  it('debería recuperar la última sesión creada filtrada por agentId', async () => {
    const sessionId1 = `session-1-${Date.now()}`;
    const sessionId2 = `session-2-${Date.now()}`;
    const agentId = 'agent-1';
    
    await saveMessage({ sessionId: sessionId1, project: "test", role: "user", content: "M1", agentId });
    await saveMessage({ sessionId: sessionId2, project: "test", role: "user", content: "M2", agentId: 'other-agent' });

    const result = await lastSession({ agentId });
    expect(result).to.equal(sessionId1);
  });
});
