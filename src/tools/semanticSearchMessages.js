const { db } = require("../database");
const embeddingService = require("../services/embeddingService");
const { lexicalSearch, countEmbeddings } = require("../services/lexicalSearch");
const { config } = require("../config");

async function semanticSearchMessages({ query, project, agentId, limit = 5, owner }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");
  if (!project) throw new Error("El parámetro 'project' es obligatorio para aislar los datos por proyecto.");

  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
  const effectiveLimit = Math.min(requestedLimit, config.searchLimit);

  const fallbackToLexical = async () => {
    const rows = await lexicalSearch({ searchTerm: query, project, agentId, owner, limit: effectiveLimit });
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

  if (!embeddingService.isEmbeddingsEnabled()) {
    return await fallbackToLexical();
  }

  const embeddingCount = await countEmbeddings(project, agentId, owner);
  if (embeddingCount === 0) {
    return await fallbackToLexical();
  }

  let queryEmbeddingJson;
  try {
    queryEmbeddingJson = await embeddingService.generateEmbedding({
      role: "search",
      content: query,
    });
  } catch (error) {
    console.warn("Semantic embedding failed; falling back to lexical search:", error.message);
    return await fallbackToLexical();
  }

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

  whereClauses.push(`c.project = $${params.length + 1}`);
  params.push(project);

  if (agentId) {
    whereClauses.push(`c.agent_id = $${params.length + 1}`);
    params.push(agentId);
  }

  if (owner) {
    whereClauses.push(`c.owner = $${params.length + 1}`);
    params.push(owner);
  }

  sql += ` WHERE ` + whereClauses.join(" AND ");
  sql += ` ORDER BY me.embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
  params.push(effectiveLimit);

  const results = await db.allAsync(sql, params);

  if (results.length > 0) {
    return results;
  }
  return await fallbackToLexical();
}

module.exports = semanticSearchMessages;
