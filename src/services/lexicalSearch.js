// src/services/lexicalSearch.js
//
// Búsqueda léxica sobre el contenido de los mensajes (ILIKE por término),
// sin depender de embeddings ni del modelo. Es el fallback disponible siempre:
// permite que cualquier agente recupere conocimiento aunque el worker de
// embeddings nunca haya indexado los mensajes.

const { db } = require("../database");

/**
 * Cuenta cuántos mensajes del proyecto (y opcionalmente del agente) tienen
 * embedding indexado. Si el resultado es 0, la vía semántica no puede
 * responder y conviene caer directo a la búsqueda léxica.
 * @param {string} [project]
 * @param {string} [agentId]
 * @returns {Promise<number>}
 */
async function countEmbeddings(project, agentId) {
  const params = [];
  const where = [];
  if (project) {
    params.push(project);
    where.push(`c.project = $${params.length}`);
  }
  if (agentId) {
    params.push(agentId);
    where.push(`c.agent_id = $${params.length}`);
  }

  const sql = `
    SELECT count(*)::int AS n
    FROM message_embeddings me
    INNER JOIN conversations c ON c.id = me.message_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;

  const row = await db.getAsync(sql, params);
  return row ? row.n : 0;
}

/**
 * Busca mensajes por coincidencia léxica del contenido, ordenados por la
 * cantidad de términos coincidentes y luego por fecha descendente.
 * @param {Object} params
 * @param {string} params.searchTerm - Término o consulta de búsqueda.
 * @param {string} [params.project]
 * @param {string} [params.agentId]
 * @param {number} [params.limit]
 * @returns {Promise<Array>} Filas con campos de conversations + lexical_score.
 */
async function lexicalSearch({ searchTerm, project, agentId, limit = 50 }) {
  const tokens = (searchTerm || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2);

  if (tokens.length === 0) return [];

  try {
    const dbParams = [];
    const whereClauses = [];
    const scoreExpr = [];

    if (project) {
      dbParams.push(project);
      whereClauses.push(`c.project = $${dbParams.length}`);
    }
    if (agentId) {
      dbParams.push(agentId);
      whereClauses.push(`c.agent_id = $${dbParams.length}`);
    }

    const likeClauses = tokens.map((token) => {
      dbParams.push(`%${token}%`);
      scoreExpr.push(`(c.content ILIKE $${dbParams.length})::int`);
      return `c.content ILIKE $${dbParams.length}`;
    });
    whereClauses.push(`(${likeClauses.join(" OR ")})`);

    const sql = `
      SELECT c.*, (${scoreExpr.join(" + ")})::float AS lexical_score
      FROM conversations c
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY lexical_score DESC, c.timestamp DESC
      LIMIT $${dbParams.length + 1}
    `;
    dbParams.push(limit);

    return await db.allAsync(sql, dbParams);
  } catch (err) {
    console.error("Error in lexical search:", err.message);
    throw err;
  }
}

module.exports = { lexicalSearch, countEmbeddings };