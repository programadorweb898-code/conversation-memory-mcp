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
});
