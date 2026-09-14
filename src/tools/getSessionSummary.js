const { db } = require("../database");

/**
 * Recupera el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @returns {Promise<Object|null>} - El resumen y su timestamp o null si no existe.
 */
async function getSessionSummary({ sessionId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const sql = `SELECT summary, timestamp FROM session_summaries WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)`;
    const row = await db.getAsync(sql, [sessionId, project, owner ?? null]);
    return row || null;
  } catch (err) {
    console.error("Error retrieving session summary:", err.message);
    throw err;
  }
}

module.exports = getSessionSummary;
