const { db } = require("../database");

/**
 * Recupera el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @returns {Promise<Object|null>} - El resumen y su timestamp o null si no existe.
 */
async function getSessionSummary({ sessionId }) {
  try {
    const sql = `SELECT summary, timestamp FROM session_summaries WHERE session_id = $1`;
    const row = await db.getAsync(sql, [sessionId]);
    return row || null;
  } catch (err) {
    console.error("Error retrieving session summary:", err.message);
    throw err;
  }
}

module.exports = getSessionSummary;
