const { expect } = require('chai');
const saveSessionSummary = require("../src/tools/saveSessionSummary");
const getSessionSummary = require("../src/tools/getSessionSummary");
const saveMessage = require("../src/tools/saveMessage"); // Import saveMessage
const db = require("../src/database");

describe('Session Summaries Tool', () => {
  const testSessionId = "test-session-summary-123";
  const testMessage1 = { sessionId: testSessionId, project: "test", role: "user", content: "Hola, ¿cómo estás?" };
  const testMessage2 = { sessionId: testSessionId, project: "test", role: "assistant", content: "Estoy bien, gracias. ¿En qué puedo ayudarte?" };
  const testMessage3 = { sessionId: testSessionId, project: "test", role: "user", content: "Necesito un resumen de esta conversación." };

  beforeEach(async () => {
    // Limpiar mensajes y resúmenes de sesiones anteriores
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM conversations WHERE session_id = ?`, [testSessionId], (err) => {
        if (err) reject(err);
        resolve();
      });
    });
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM session_summaries WHERE session_id = ?`, [testSessionId], (err) => {
        if (err) reject(err);
        resolve();
      });
    });
    // Guardar mensajes de prueba
    await saveMessage(testMessage1);
    await saveMessage(testMessage2);
    await saveMessage(testMessage3);
  });

  afterEach(async () => {
    // Limpiar mensajes y resúmenes después de cada prueba
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM conversations WHERE session_id = ?`, [testSessionId], (err) => {
        if (err) reject(err);
        resolve();
      });
    });
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM session_summaries WHERE session_id = ?`, [testSessionId], (err) => {
        if (err) reject(err);
        resolve();
      });
    });
  });

  it('debería generar y guardar un resumen de sesión correctamente', async () => {
    await saveSessionSummary({ sessionId: testSessionId });
    
    const result = await getSessionSummary({ sessionId: testSessionId });
    expect(result).to.exist;
    expect(result.summary).to.include(testMessage1.content);
    expect(result.summary).to.include(testMessage2.content);
    expect(result.summary).to.include(testMessage3.content);
    expect(result.summary).to.exist;
    expect(result.timestamp).to.exist;
  });

  it('debería actualizar un resumen existente (upsert) con nuevo contenido', async () => {
    // Guardar un primer resumen
    await saveSessionSummary({ sessionId: testSessionId });
    
    // Simular una nueva interacción añadiendo un mensaje
    const newMessage = { sessionId: testSessionId, project: "test", role: "assistant", content: "Entendido, estoy generando el resumen." };
    await saveMessage(newMessage);

    // Guardar el resumen actualizado
    await saveSessionSummary({ sessionId: testSessionId });

    const result = await getSessionSummary({ sessionId: testSessionId });
    expect(result).to.exist;
    expect(result.summary).to.include(testMessage1.content);
    expect(result.summary).to.include(testMessage2.content);
    expect(result.summary).to.include(testMessage3.content);
    expect(result.summary).to.include(newMessage.content);
  });
});
