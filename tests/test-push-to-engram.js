const { expect } = require('chai');
const pushToEngram = require("../src/tools/pushToEngram");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Push To Engram Tool', () => {
  let testSessionId;

  afterEach(async () => {
    try {
      if (testSessionId) {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [testSessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      }
    } catch (err) {
      console.error("Error en limpieza de test-push-to-engram:", err.message);
    }
  });

  it('debería recuperar un mensaje específico por su ID', async () => {
    testSessionId = `test-session-${Date.now()}`;
    const content = "Contenido crítico";
    
    // Guardamos un mensaje
    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content });
    
    // Obtenemos el ID del mensaje recién guardado utilizando db.getAsync
    const message = await db.getAsync(`SELECT id FROM conversations WHERE session_id = $1`, [testSessionId]);

    // Probamos la herramienta
    const result = await pushToEngram({ messageId: message.id });
    
    // Validamos la nueva estructura
    expect(result).to.have.property('message');
    expect(result).to.have.property('suggestion');
    expect(result.message.content).to.equal(content);
    expect(result.suggestion).to.have.property('title');
  });
});
