const { db, dbReadyPromise } = require("../database");

/**
 * Recupera el ID de la última sesión registrada en la base de datos.
 * @returns {Promise<string|null>} - El ID de la sesión más reciente o null si no hay registros.
 */
async function lastSession() {
  await dbReadyPromise;
  try {
    const sql = `SELECT session_id FROM conversations ORDER BY timestamp DESC, rowid DESC LIMIT 1`;
    const row = await db.getAsync(sql);
    return row ? row.session_id : null;
  } catch (err) { 
    console.error("Error retrieving last session:", err.message);
    throw err;
  }
}

module.exports = lastSession;
