const { expect } = require('chai');
const pushToEngram = require("../src/tools/pushToEngram");
const saveMessage = require("../src/tools/saveMessage");
const db = require("../src/database");

describe('Push To Engram Tool', () => {
  it('debería recuperar un mensaje específico por su ID', async () => {
    const sessionId = `test-session-${Date.now()}`;
    const content = "Contenido crítico";
    
    // Guardamos un mensaje
    await saveMessage({ sessionId, project: "test", role: "user", content });
    
    // Obtenemos el ID del mensaje recién guardado (necesitamos consultar la DB)
    const message = await new Promise((resolve) => {
        db.get(`SELECT id FROM conversations WHERE session_id = ?`, [sessionId], (err, row) => {
            resolve(row);
        });
    });

    // Probamos la herramienta
    const result = await pushToEngram({ messageId: message.id });
    
    expect(result.content).to.equal(content);
  });
});
