const generateSessionSummary = require("./generateSessionSummary");
const saveSessionSummary = require("./saveSessionSummary");

async function finalizeSession(sessionId) {
  console.log(`Finalizando sesión: ${sessionId}`);
  const summary = await generateSessionSummary({ sessionId });
  await saveSessionSummary({ sessionId, summary });
  return { summary, auditRequired: true };
}

module.exports = finalizeSession;
