const { expect } = require('chai');
const searchMessages = require("../src/tools/searchMessages");
const saveMessage = require("../src/tools/saveMessage");

describe('Search Messages Tool', () => {
  it('debería encontrar un mensaje previamente guardado mediante búsqueda semántica', async () => {
    const testContent = "Esta es una prueba de búsqueda de JWT";
    const sessionId = `test-session-search-${Date.now()}`;
    
    await saveMessage({
      sessionId: sessionId,
      project: "test-project",
      role: "assistant",
      content: testContent
    });

    const results = await searchMessages({ query: "JWT" });
    
    const found = results.some(m => m.content === testContent);
    expect(found).to.be.true;
  });
});
