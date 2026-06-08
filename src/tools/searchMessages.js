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

  try {
    let sql = `SELECT c.* ${query ? ", me.embedding" : ""} FROM conversations c`;
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

    const rows = await db.allAsync(sql, dbParams);
    if (!query) {
      return rows;
    }

    const queryEmbeddingJson = await generateEmbedding(query);
    const queryEmbedding = JSON.parse(queryEmbeddingJson);

    if (!Array.isArray(queryEmbedding)) {
      throw new Error("No se pudo generar el embedding valido para la consulta.");
    }

    const scoredResults = rows.map((row) => {
      const embedding = JSON.parse(row.embedding);
      const similarity = dotProduct(queryEmbedding, embedding);
      return { ...row, similarity };
    });

    const SIMILARITY_THRESHOLD = 0.5;
    return scoredResults
      .filter((result) => result.similarity > SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity);
  } catch (err) {
    console.error("Error searching messages:", err.message);
    throw err;
  }
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

module.exports = searchMessages;
