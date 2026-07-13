const { db } = require("../database");

/**
 * Recupera el ID de la última sesión registrada en la base de datos.
 * @param {Object} [params] - Parámetros opcionales.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<string|null>} - El ID de la sesión más reciente o null si no hay registros.
 */
async function lastSession({ agentId } = {}) {
  try {
    let sql = `SELECT session_id FROM conversations`;
    const params = [];
    if (agentId) {
      sql += ` WHERE agent_id = $1`;
      params.push(agentId);
    }
    sql += ` ORDER BY timestamp DESC LIMIT 1`;
    const row = await db.getAsync(sql, params);
    return row ? row.session_id : null;
  } catch (err) {
    console.error("Error retrieving last session (DB inaccessible):", err.message);
    // Lanzar error específico para que el llamante pueda identificar el fallo de conexión
    throw new Error("DB_CONNECTION_FAILURE");
  }
}

module.exports = lastSession;
module.exports.lastSession = lastSession;
