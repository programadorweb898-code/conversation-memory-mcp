const { db } = require("../database");

/**
 * Recupera el ID de la última sesión registrada en la base de datos.
 * @returns {Promise<string|null>} - El ID de la sesión más reciente o null si no hay registros.
 */
async function lastSession() {
  try {
    const sql = `SELECT session_id FROM conversations ORDER BY timestamp DESC LIMIT 1`;
    const row = await db.getAsync(sql);
    return row ? row.session_id : null;
  } catch (err) {
    console.error("Error retrieving last session (DB inaccessible):", err.message);
    // Lanzar error específico para que el llamante pueda identificar el fallo de conexión
    throw new Error("DB_CONNECTION_FAILURE");
  }
}

module.exports = lastSession;
module.exports.lastSession = lastSession;
