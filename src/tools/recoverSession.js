const db = require("../database");

/**
 * Recupera todos los mensajes de una sesión específica, ordenados cronológicamente.
 * @param {Object} params - Parámetros de recuperación.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @returns {Promise<Array>} - Lista de mensajes de la sesión.
 */
async function recoverSession({ sessionId }) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp ASC`;
    
    db.all(sql, [sessionId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

module.exports = recoverSession;
