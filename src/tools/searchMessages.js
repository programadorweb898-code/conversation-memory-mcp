const db = require("../database");
const { z } = require("zod");
const { generateEmbedding } = require("../services/embeddingService");

const SearchMessagesSchema = z.object({
  query: z.string().optional(),
  keyword: z.string().optional(),
  project: z.string().optional(),
}).refine(data => data.query || data.keyword || data.project, {
  message: "Se requiere al menos uno de: query, keyword, o project",
});

/**
 * Busca mensajes en la base de datos.
 */
async function searchMessages(params) {
  const validatedParams = SearchMessagesSchema.parse(params);
  const { query, keyword, project } = validatedParams;

  return new Promise((resolve, reject) => {
    let sql = `SELECT c.* ${query ? ', me.embedding' : ''} FROM conversations c`;
    if (query) {
      sql += ` JOIN message_embeddings me ON c.id = me.message_id`;
    }

    const dbParams = [];
    const whereClauses = [];

    if (project) {
      whereClauses.push(`c.project = ?`);
      dbParams.push(project);
    }

    if (keyword) {
      whereClauses.push(`c.content LIKE ?`);
      dbParams.push(`%${keyword}%`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(` AND `);
    }

    db.all(sql, dbParams, async (err, rows) => {
      if (err) return reject(err);

      if (query) {
        try {
          const queryEmbeddingJson = await generateEmbedding(query);
          const queryEmbedding = JSON.parse(queryEmbeddingJson);

          if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
            throw new Error("No se pudo generar el embedding válido para la consulta.");
          }

          const scoredResults = rows.map((row) => {
            const embedding = JSON.parse(row.embedding);
            const similarity = dotProduct(queryEmbedding, embedding);
            return { ...row, similarity };
          });

          const SIMILARITY_THRESHOLD = 0.5;
          const filtered = scoredResults.filter(r => r.similarity > SIMILARITY_THRESHOLD);
          filtered.sort((a, b) => b.similarity - a.similarity);
          
          resolve(filtered);
        } catch (error) {
          reject(error);
        }
      } else {
        resolve(rows);
      }
    });
  });
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

module.exports = searchMessages;
