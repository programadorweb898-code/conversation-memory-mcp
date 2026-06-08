const db = require('../database');
const { generateEmbedding } = require('../services/embeddingService');

async function semanticSearchMessages({ query, project, limit = 5 }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");

  const queryEmbeddingJson = await generateEmbedding(query);
  const queryEmbedding = JSON.parse(queryEmbeddingJson); // This is an array of floats

  // Convert queryEmbedding to a Buffer (Float32Array) for vss_search
  const queryEmbeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

  let sql = `
    SELECT
      T1.id AS message_id,
      T2.content,
      T2.session_id,
      T2.project,
      T2.role,
      T2.timestamp,
      T2.agent_id,
      vss_search(T1.embedding, ?) AS distance
    FROM vss_embeddings AS T1
    JOIN conversations AS T2 ON T1.id = T2.id
  `;
  const params = [queryEmbeddingBuffer];

  if (project) {
    sql += ` WHERE T2.project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY distance LIMIT ?`;
  params.push(limit);

  const messages = await db.allAsync(sql, params);

  return messages.map(msg => ({
    message_id: msg.message_id,
    content: msg.content,
    session_id: msg.session_id,
    project: msg.project,
    role: msg.role,
    timestamp: msg.timestamp,
    agent_id: msg.agent_id,
    distance: msg.distance // Expose the distance for now, can be transformed to similarity if needed
  }));
}

module.exports = semanticSearchMessages;

