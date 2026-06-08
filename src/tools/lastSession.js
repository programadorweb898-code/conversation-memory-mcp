const db = require("../database");

/**
 * Recupera el ID de la última sesión registrada en la base de datos.
 * @returns {Promise<string|null>} - El ID de la sesión más reciente o null si no hay registros.
 */
async function lastSession() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT session_id FROM conversations ORDER BY timestamp DESC, rowid DESC LIMIT 1`;

    db.get(sql, [], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.session_id : null);
      }
    });
  });
}

module.exports = lastSession;
