const { expect } = require('chai');
const saveSessionSummary = require("../src/tools/saveSessionSummary");
const getSessionSummary = require("../src/tools/getSessionSummary");
const db = require("../src/database");

describe('Session Summaries Tool', () => {
  const testSessionId = "test-session-summary-123";

  it('debería guardar y recuperar un resumen de sesión correctamente', async () => {
    const summaryText = "Esta sesión trató sobre la configuración inicial de MCP.";
    await saveSessionSummary({ sessionId: testSessionId, summary: summaryText });
    
    const result = await getSessionSummary({ sessionId: testSessionId });
    expect(result.summary).to.equal(summaryText);
    expect(result.timestamp).to.exist;
  });

  it('debería actualizar un resumen existente (upsert)', async () => {
    const newSummaryText = "Resumen actualizado.";
    await saveSessionSummary({ sessionId: testSessionId, summary: newSummaryText });

    return new Promise((resolve, reject) => {
      db.get("SELECT summary FROM session_summaries WHERE session_id = ?", [testSessionId], (err, row) => {
        if (err) return reject(err);
        expect(row.summary).to.equal(newSummaryText);
        resolve();
      });
    });
  });
});
