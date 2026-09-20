const lastSession = require("./lastSession");
const getSessionSummary = require("./getSessionSummary");
const recoverSession = require("./recoverSession");

/**
 * Recupera el ID de la última sesión, su resumen y sus mensajes.
 * @param {Object} [params] - Parámetros opcionales.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<Object>} - El ID de la sesión, el resumen y los mensajes.
 */
async function getLastSessionContext({ project, agentId, owner } = {}) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const sessionId = await lastSession.lastSession({ project, agentId, owner });
    if (!sessionId) {
      return { sessionId: null, summary: null, messages: [] };
    }
    const summaryData = await getSessionSummary({ sessionId, project, owner });
    const messages = await recoverSession({ sessionId, project, agentId, owner });
    return { sessionId, summary: summaryData ? summaryData.summary : null, messages };
  } catch (err) {
    if (err.message === "DB_CONNECTION_FAILURE") {
      throw err;
    }
    throw err;
  }
}

module.exports = getLastSessionContext;
