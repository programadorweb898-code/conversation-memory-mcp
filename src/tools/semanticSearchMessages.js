const { db } = require("../database");
const { generateEmbedding, calculateCosineSimilarity } = require("../services/embeddingService");

async function semanticSearchMessages({ query, project, limit = 5 }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");
// ...
  const queryEmbeddingJson = await generateEmbedding(query);
  const queryEmbedding = JSON.parse(queryEmbeddingJson); // Esto es un array de floats

  let sql = `
    SELECT
      me.message_id,
      me.embedding AS message_embedding_json,
      c.content,
      c.session_id,
      c.project,
      c.role,
      c.timestamp,
      c.agent_id
    FROM message_embeddings AS me
    JOIN conversations AS c ON me.message_id = c.id
  `;
  const params = [];

  if (project) {
    sql += ` WHERE c.project = $1`;
    params.push(project);
  }

  const allMessagesWithEmbeddings = await db.allAsync(sql, params);

  const resultsWithSimilarity = allMessagesWithEmbeddings.map((row) => {
    const messageEmbedding = JSON.parse(row.message_embedding_json);
    const similarity = calculateCosineSimilarity(queryEmbedding, messageEmbedding);
    return {
      message_id: row.message_id,
      content: row.content,
      session_id: row.session_id,
      project: row.project,
      role: row.role,
      timestamp: row.timestamp,
      agent_id: row.agent_id,
      similarity: similarity,
    };
  });

  resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

  return resultsWithSimilarity.slice(0, limit);
}

module.exports = semanticSearchMessages;
