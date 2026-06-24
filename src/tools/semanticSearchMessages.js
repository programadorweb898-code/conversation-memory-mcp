const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");

async function semanticSearchMessages({ query, project, limit = 5 }) {
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

  if (project) {
    sql += ` WHERE c.project = $2`;
    params.push(project);
  }

  sql += ` ORDER BY me.embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
  params.push(limit);

  const results = await db.allAsync(sql, params);

  return results;
}

module.exports = semanticSearchMessages;
