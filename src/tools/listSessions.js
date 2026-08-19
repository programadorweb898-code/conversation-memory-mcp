const { db } = require("../database");

/**
 * Lista todas las sesiones disponibles con información básica.
 * @param {Object} [params] - Parámetros opcionales.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @returns {Promise<Array>} - Lista de objetos con session_id y timestamp de última actividad.
 */
async function listSessions({ project, agentId } = {}) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    let sql = `
      SELECT session_id, MAX(timestamp) as last_activity 
      FROM conversations 
      WHERE project = $1
    `;
    const params = [project];
    if (agentId) {
      sql += ` AND agent_id = $2`;
      params.push(agentId);
    }
    sql += `
      GROUP BY session_id 
      ORDER BY last_activity DESC
    `;

    const rows = await db.allAsync(sql, params);
    return rows || [];
  } catch (err) {
    console.error("Error listing sessions:", err.message);
    throw err;
  }
}

module.exports = listSessions;
