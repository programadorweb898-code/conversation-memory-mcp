const lastSession = require("./lastSession");
const getSessionSummary = require("./getSessionSummary");
const recoverSession = require("./recoverSession");

/**
 * Recupera el ID de la última sesión, su resumen y sus mensajes.
 * @param {Object} [params] - Parámetros opcionales.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<Object>} - El ID de la sesión, el resumen y los mensajes.
 */
async function getLastSessionContext({ project, agentId, owner, sessionId: requestedSessionId, beforeSequenceId, limit } = {}) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const sessionId = requestedSessionId || await lastSession.lastSession({ project, agentId, owner });
    if (!sessionId) {
      return { sessionId: null, summary: null, messages: [], hasMore: false, truncated: false, nextBeforeSequenceId: null };
    }
    const summaryData = await getSessionSummary({ sessionId, project, owner });
    const page = await recoverSession({ sessionId, project, agentId, owner, latest: true, beforeSequenceId, limit });
    return { sessionId, summary: summaryData ? summaryData.summary : null, ...page };
  } catch (err) {
    if (err.message === "DB_CONNECTION_FAILURE") {
      throw err;
    }
    throw err;
  }
}

module.exports = getLastSessionContext;

