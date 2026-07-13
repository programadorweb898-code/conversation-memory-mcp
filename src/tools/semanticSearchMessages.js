const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");

async function semanticSearchMessages({ query, project, agentId, limit = 5 }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");

  // Generar embedding de la consulta
  const queryEmbeddingJson = await generateEmbedding({ role: "search", content: query });
  
  // pgvector espera el formato '[x,y,z]' que es lo que devuelve generateEmbedding
  // SQL: <-> es distancia euclidiana, <=> es distancia coseno.
  // pgvector utiliza la distancia de coseno (1 - similitud).
  // Ordenamos por distancia ascendente (menor distancia = mayor similitud).
  
  let sql = `
    SELECT
      c.id AS message_id,
      c.content,
      c.session_id,
      c.project,
      c.role,
      c.timestamp,
      c.agent_id,
      (1 - (me.embedding <=> $1::vector)) AS similarity
    FROM message_embeddings AS me
    JOIN conversations AS c ON me.message_id = c.id
  `;
  const params = [queryEmbeddingJson];
  const whereClauses = [];

  if (project) {
    whereClauses.push(`c.project = $${params.length + 1}`);
    params.push(project);
  }

  if (agentId) {
    whereClauses.push(`c.agent_id = $${params.length + 1}`);
    params.push(agentId);
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(' AND ');
  }

  sql += ` ORDER BY me.embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
  params.push(limit);

  const results = await db.allAsync(sql, params);

  return results;
}


module.exports = semanticSearchMessages;
