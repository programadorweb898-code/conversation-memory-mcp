const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");
const { lexicalSearch, countEmbeddings } = require("../services/lexicalSearch");

async function semanticSearchMessages({ query, project, agentId, limit = 5 }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");
  if (!project) throw new Error("El parámetro 'project' es obligatorio para aislar los datos por proyecto.");

  const fallbackToLexical = async () => {
    const rows = await lexicalSearch({ searchTerm: query, project, agentId, limit });
    return rows.map((row) => ({
      message_id: row.id,
      content: row.content,
      session_id: row.session_id,
      project: row.project,
      role: row.role,
      timestamp: row.timestamp,
      agent_id: row.agent_id,
      similarity: Number(row.lexical_score) || 0,
    }));
  };

  // Sin embeddings indexados no hay vía semántica posible: respondemos con
  // búsqueda léxica sin cargar el modelo (rápida y siempre disponible).
  const embeddingCount = await countEmbeddings(project, agentId);
  if (embeddingCount === 0) {
    return await fallbackToLexical();
  }

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

  // Los embeddings existen pero no aportaron coincidencias: igual respondemos
  // con coincidencias léxicas antes de devolver vacío.
  if (results.length > 0) {
    return results;
  }
  return await fallbackToLexical();
}

module.exports = semanticSearchMessages;
