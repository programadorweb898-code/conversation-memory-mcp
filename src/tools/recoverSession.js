const db = require("../database");

/**
 * Recupera todos los mensajes de una sesión específica, ordenados cronológicamente.
 * @param {Object} params - Parámetros de recuperación.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @returns {Promise<Array>} - Lista de mensajes de la sesión.
 */
async function recoverSession({ sessionId }) {
  try {
    const sql = `SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp ASC`;
    return await db.allAsync(sql, [sessionId]);
  } catch (err) {
    console.error("Error recovering session:", err.message);
    throw err;
  }
}

module.exports = recoverSession;
