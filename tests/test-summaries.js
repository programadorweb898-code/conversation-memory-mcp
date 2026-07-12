/*
  NOTA: Este test requiere que la variable de entorno GEMINI_API_KEY esté configurada para interactuar con la API de Gemini y generar los resúmenes.
*/
const { expect } = require('chai');
const finalizeSession = require("../src/tools/finalizeSession");
const getSessionSummary = require("../src/tools/getSessionSummary");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Session Summaries Tool', () => {
  const testSessionId = "test-session-summary-123";
  const testMessage1 = { sessionId: testSessionId, project: "test", role: "user", content: "Hola, ¿cómo estás?" };
  const testMessage2 = { sessionId: testSessionId, project: "test", role: "assistant", content: "Estoy bien, gracias. ¿En qué puedo ayudarte?" };
  const testMessage3 = { sessionId: testSessionId, project: "test", role: "user", content: "Necesito un resumen de esta conversación." };

  beforeEach(async () => {
    try {
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza inicial de test-summaries:", err.message);
    }

    await saveMessage(testMessage1);
    await saveMessage(testMessage2);
    await saveMessage(testMessage3);
  }).timeout(30000);

  afterEach(async () => {
    try {
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza final de test-summaries:", err.message);
    }
  }).timeout(30000);

  it('debería generar y guardar un resumen de sesión correctamente', async function() {
    this.timeout(30000);
    await finalizeSession(testSessionId);
    
    const result = await getSessionSummary({ sessionId: testSessionId });
    expect(result).to.exist;
    
    const parsedSummary = JSON.parse(result.summary);
    expect(parsedSummary).to.have.property('goal');
    expect(parsedSummary).to.have.property('discoveries');
    expect(parsedSummary).to.have.property('accomplished');
    expect(parsedSummary).to.have.property('next_steps');
    expect(result.timestamp).to.exist;
  });

  it('debería actualizar un resumen existente (upsert) con nuevo contenido', async function() {
    this.timeout(30000);
    await finalizeSession(testSessionId);
    
    const newMessage = { sessionId: testSessionId, project: "test", role: "assistant", content: "Entendido, estoy generando el resumen." };
    await saveMessage(newMessage);

    await finalizeSession(testSessionId);

    const result = await getSessionSummary({ sessionId: testSessionId });
    expect(result).to.exist;
    
    const parsedSummary = JSON.parse(result.summary);
    expect(parsedSummary).to.have.property('goal');
    expect(parsedSummary).to.have.property('discoveries');
    expect(parsedSummary).to.have.property('accomplished');
    expect(parsedSummary).to.have.property('next_steps');
  });
});
