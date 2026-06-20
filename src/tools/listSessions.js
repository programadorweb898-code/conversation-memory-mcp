const { db, dbReadyPromise } = require("../database");

/**
 * Lista todas las sesiones disponibles con información básica.
 * @returns {Promise<Array>} - Lista de objetos con session_id y timestamp de última actividad.
 */
async function listSessions() {
  await dbReadyPromise;
  try {
    const sql = `
      SELECT session_id, MAX(timestamp) as last_activity 
      FROM conversations 
      GROUP BY session_id 
      ORDER BY last_activity DESC
    `;

    const rows = await db.allAsync(sql);
    return rows || [];
  } catch (err) {
    console.error("Error listing sessions:", err.message);
    throw err;
  }
}

module.exports = listSessions;
