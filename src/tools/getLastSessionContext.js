const lastSession = require("./lastSession");
const recoverSession = require("./recoverSession");

/**
 * Recupera el ID de la última sesión y todos sus mensajes en una sola llamada.
 * @returns {Promise<Object>} - El ID de la sesión y los mensajes.
 */
async function getLastSessionContext() {
  const sessionId = await lastSession();
  if (!sessionId) {
    return { sessionId: null, messages: [] };
  }
  const messages = await recoverSession({ sessionId });
  return { sessionId, messages };
}

module.exports = getLastSessionContext;
