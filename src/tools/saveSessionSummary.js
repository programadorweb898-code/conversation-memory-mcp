const db = require("../database");

/**
 * Guarda o actualiza el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @param {string} params.summary - El contenido del resumen.
 * @returns {Promise<boolean>}
 */
async function saveSessionSummary({ sessionId, summary }) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO session_summaries (session_id, summary, timestamp)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        timestamp = excluded.timestamp
    `;

    db.run(sql, [sessionId, summary], (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

module.exports = saveSessionSummary;
