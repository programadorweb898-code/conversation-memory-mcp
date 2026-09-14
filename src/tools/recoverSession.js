const { db } = require("../database");

/**
 * Recupera todos los mensajes de una sesión específica, ordenados cronológicamente.
 * @param {Object} params - Parámetros de recuperación.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<Array>} - Lista de mensajes de la sesión.
 */
async function recoverSession({ sessionId, project, agentId, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const params = [];
    const where = [
      `session_id = $1`,
      `project = $2`,
    ];
    params.push(sessionId, project);
    if (agentId) {
      where.push(`agent_id = $${params.length + 1}`);
      params.push(agentId);
    }
    if (owner) {
      where.push(`owner = $${params.length + 1}`);
      params.push(owner);
    }
    const sql = `SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY timestamp ASC`;
    return await db.allAsync(sql, params);
  } catch (err) { 
    console.error("Error recovering session:", err.message);
    throw err;
  }
}

module.exports = recoverSession;
