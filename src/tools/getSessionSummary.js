const db = require("../database");

/**
 * Recupera el resumen de una sesión específica.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @returns {Promise<Object|null>} - El resumen y su timestamp o null si no existe.
 */
async function getSessionSummary({ sessionId }) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT summary, timestamp FROM session_summaries WHERE session_id = ?`;

    db.get(sql, [sessionId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

module.exports = getSessionSummary;
