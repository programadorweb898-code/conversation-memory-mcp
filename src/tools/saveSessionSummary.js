const { db, dbReadyPromise } = require("../database");
const generateSessionSummary = require("./generateSessionSummary");

/**
 * Guarda o actualiza el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @returns {Promise<boolean>}
 */
async function saveSessionSummary({ sessionId }) {
  await dbReadyPromise;
  try {
    const summary = await generateSessionSummary({ sessionId });
    const sql = `
      INSERT INTO session_summaries (session_id, summary, timestamp)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        timestamp = excluded.timestamp
    `;

    await db.runAsync(sql, [sessionId, summary]);
    return true;
  } catch (err) {
    console.error("Error saving session summary:", err.message);
    throw err;
  }
}

module.exports = saveSessionSummary;
