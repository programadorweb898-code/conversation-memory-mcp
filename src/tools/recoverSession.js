const { db } = require("../database");
const { config } = require("../config");

/**
 * Recupera mensajes de una sesión específica, ordenados cronológicamente.
 * @param {Object} params - Parámetros de recuperación.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @param {string} params.project - Proyecto para filtrar.
 * @param {string} [params.agentId] - ID del agente para filtrar.
 * @param {string} [params.owner] - Owner para aislar el tenant.
 * @param {string} [params.afterSequenceId] - Cursor exclusivo; solo devuelve mensajes posteriores a este sequence_id.
 * @param {number} [params.limit] - Cantidad máxima de mensajes a devolver.
 * @returns {Promise<Array>} - Lista de mensajes de la sesión.
 */
async function recoverSession({ sessionId, project, agentId, owner, afterSequenceId, limit = config.recoverSessionLimit }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : config.recoverSessionLimit;
  const effectiveLimit = Math.min(requestedLimit, config.recoverSessionLimit);

  if (afterSequenceId !== undefined && afterSequenceId !== null && !/^\d+$/.test(String(afterSequenceId))) {
    throw new Error("El parámetro 'afterSequenceId' debe ser un sequence_id entero no negativo.");
  }

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

    if (afterSequenceId !== undefined && afterSequenceId !== null) {
      where.push(`sequence_id > $${params.length + 1}::bigint`);
      params.push(String(afterSequenceId));
    }

    params.push(effectiveLimit);
    const sql = `SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY sequence_id ASC LIMIT $${params.length}`;

    return await db.allAsync(sql, params);
  } catch (err) {
    console.error("Error recovering session:", err.message);
    throw err;
  }
}

module.exports = recoverSession;
