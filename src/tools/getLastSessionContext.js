const lastSession = require("./lastSession");
const getSessionSummary = require("./getSessionSummary");

/**
 * Recupera el ID de la última sesión y su resumen.
 * El historial completo se recupera bajo demanda.
 * @returns {Promise<Object>} - El ID de la sesión y el resumen.
 */
async function getLastSessionContext() {
  try {
    const sessionId = await lastSession();
    if (!sessionId) {
      return { sessionId: null, summary: null };
    }
    const summaryData = await getSessionSummary({ sessionId });
    return { sessionId, summary: summaryData ? summaryData.summary : null };
  } catch (err) {
    if (err.message === "DB_CONNECTION_FAILURE") {
      console.warn("DB inaccessible, signaling Engram fallback.");
      return { 
        sessionId: "ENGRAM_FALLBACK_REQUIRED", 
        summary: "Error de conexión a la base de datos. Se requiere recuperar el contexto estratégico desde Engram." 
      };
    }
    throw err;
  }
}

module.exports = getLastSessionContext;
