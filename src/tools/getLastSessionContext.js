const lastSession = require("./lastSession");
const getSessionSummary = require("./getSessionSummary");

/**
 * Recupera el ID de la última sesión y su resumen.
 * El historial completo se recupera bajo demanda.
 * @returns {Promise<Object>} - El ID de la sesión y el resumen.
 */
async function getLastSessionContext() {
  const sessionId = await lastSession();
  if (!sessionId) {
    return { sessionId: null, summary: null };
  }
  const summaryData = await getSessionSummary({ sessionId });
  return { sessionId, summary: summaryData ? summaryData.summary : null };
}

module.exports = getLastSessionContext;
