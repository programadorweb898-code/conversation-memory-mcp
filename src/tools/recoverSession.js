const { db } = require("../database");

/**
 * Recupera todos los mensajes de una sesión específica, ordenados cronológicamente.
 * @param {Object} params - Parámetros de recuperación.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<Array>} - Lista de mensajes de la sesión.
 */
async function recoverSession({ sessionId, agentId }) {
  try {
    let sql = `SELECT * FROM conversations WHERE session_id = $1`;
    const params = [sessionId];
    if (agentId) {
      sql += ` AND agent_id = $2`;
      params.push(agentId);
    }
    sql += ` ORDER BY timestamp ASC`;
    return await db.allAsync(sql, params);
  } catch (err) { 
    console.error("Error recovering session:", err.message);
    throw err;
  }
}

module.exports = recoverSession;
