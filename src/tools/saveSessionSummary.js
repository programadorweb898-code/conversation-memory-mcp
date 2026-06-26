const { db } = require("../database");

/**
 * Guarda o actualiza el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @param {string} params.summary - El resumen generado.
 * @param {string} params.lastProcessedMessageId - El ID del último mensaje procesado.
 * @returns {Promise<boolean>}
 */
async function saveSessionSummary({ sessionId, summary, lastProcessedMessageId }) {
  try {
    const sql = `
      INSERT INTO session_summaries (session_id, summary, last_processed_message_id, timestamp)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        last_processed_message_id = EXCLUDED.last_processed_message_id,
        timestamp = EXCLUDED.timestamp
    `;

    await db.runAsync(sql, [sessionId, summary, lastProcessedMessageId]);
    return true;
  } catch (err) {
    console.error("Error saving session summary:", err.message);
    throw err;
  }
}

module.exports = saveSessionSummary;
