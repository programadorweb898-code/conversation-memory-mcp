const { expect } = require('chai');
const recoverSession = require("../src/tools/recoverSession");
const saveMessage = require("../src/tools/saveMessage");

describe('Recover Session Tool', () => {
  it('debería recuperar todos los mensajes de una sesión en orden', async () => {
    const sessionId = `test-session-${Date.now()}`;

    await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje 1" });
    await saveMessage({ sessionId, project: "test", role: "assistant", content: "Mensaje 2" });

    const messages = await recoverSession({ sessionId });
    
    expect(messages).to.have.lengthOf(2);
    expect(messages[0].content).to.equal("Mensaje 1");
    expect(messages[1].content).to.equal("Mensaje 2");
  });

  it('debería recuperar mensajes filtrados por agentId', async () => {
    const sessionId = `test-session-agent-${Date.now()}`;
    const agentId = 'agent-1';
    const otherAgentId = 'agent-2';

    await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje A1", agentId });
    await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje A2", agentId: otherAgentId });

    const messages = await recoverSession({ sessionId, agentId });
    
    expect(messages).to.have.lengthOf(1);
    expect(messages[0].content).to.equal("Mensaje A1");
    expect(messages[0].agent_id).to.equal(agentId);
  });
});
