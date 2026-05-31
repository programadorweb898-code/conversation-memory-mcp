const { expect } = require('chai');
const saveMessage = require('../src/tools/saveMessage');

describe('Save Message Tool', () => {
  it('debería guardar un mensaje correctamente y devolver true', async () => {
    const result = await saveMessage({
      sessionId: "test-session",
      project: "test-project",
      role: "user",
      content: "Prueba de guardado"
    });
    
    expect(result).to.be.true;
  });
});
