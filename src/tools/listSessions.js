const db = require("../database");

/**
 * Lista todas las sesiones disponibles con información básica.
 * @returns {Promise<Array>} - Lista de objetos con session_id y timestamp de última actividad.
 */
async function listSessions() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT session_id, MAX(timestamp) as last_activity 
      FROM conversations 
      GROUP BY session_id 
      ORDER BY last_activity DESC
    `;

    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

module.exports = listSessions;
