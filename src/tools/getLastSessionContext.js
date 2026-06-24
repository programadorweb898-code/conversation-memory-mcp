const lastSession = require("./lastSession");
const getSessionSummary = require("./getSessionSummary");
const recoverSession = require("./recoverSession");

/**
 * Recupera el ID de la última sesión, su resumen y sus mensajes.
 * @returns {Promise<Object>} - El ID de la sesión, el resumen y los mensajes.
 */
async function getLastSessionContext() {
  try {
    const sessionId = await lastSession.lastSession();
    if (!sessionId) {
      return { sessionId: null, summary: null, messages: [] };
    }
    const summaryData = await getSessionSummary({ sessionId });
    const messages = await recoverSession({ sessionId });
    return { sessionId, summary: summaryData ? summaryData.summary : null, messages };
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
