const { expect } = require('chai');
const getLastSessionContext = require("../src/tools/getLastSessionContext");
const saveMessage = require("../src/tools/saveMessage");

describe('Get Last Session Context Tool', () => {
  it('debería recuperar el contexto completo de la última sesión', async () => {
    const sessionId = `test-session-${Date.now()}`;

    await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje 1" });

    const context = await getLastSessionContext();
    
    expect(context.sessionId).to.equal(sessionId);
    expect(context.messages).to.have.lengthOf(1);
    expect(context.messages[0].content).to.equal("Mensaje 1");
  });
});
