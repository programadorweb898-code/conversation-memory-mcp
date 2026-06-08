const db = require('../database');
const { generateEmbedding } = require('../services/embeddingService');

async function semanticSearchMessages({ query, project, limit = 5 }) {
  if (!query) {
    throw new Error("La consulta no puede estar vacía.");
  }

  const queryEmbedding = await generateEmbedding(query);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    throw new Error("No se pudo generar el embedding para la consulta.");
  }

  return new Promise((resolve, reject) => {
    db.all(`SELECT message_id, embedding FROM message_embeddings`, async (err, rows) => {
      if (err) {
        return reject(err);
      }

      let similarities = [];
      for (const row of rows) {
        const messageEmbedding = JSON.parse(row.embedding);
        const similarity = cosineSimilarity(queryEmbedding, messageEmbedding);
        similarities.push({ message_id: row.message_id, similarity });
      }

      similarities.sort((a, b) => b.similarity - a.similarity);
      const topMessageIds = similarities.slice(0, limit).map(s => s.message_id);

      if (topMessageIds.length === 0) {
        return resolve([]);
      }

      const placeholders = topMessageIds.map(() => '?').join(',');
      db.all(`SELECT * FROM conversations WHERE id IN (${placeholders})`, topMessageIds, (err, messages) => {
        if (err) {
          return reject(err);
        }
        resolve(messages);
      });
    });
  });
}

// Function to calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

module.exports = semanticSearchMessages;
