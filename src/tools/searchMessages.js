const db = require("../database");
const { z } = require("zod");
const { generateEmbedding, calculateCosineSimilarity } = require("../services/embeddingService");

const SearchMessagesSchema = z.object({
  searchTerm: z.string().optional(),
  project: z.string().optional(),
}).refine(data => data.searchTerm || data.project, {
  message: "Se requiere al menos uno de: searchTerm o project",
});

/**
 * Busca mensajes en la base de datos.
 */
async function searchMessages(params) {
  const validatedParams = SearchMessagesSchema.parse(params);
  const { searchTerm, project } = validatedParams;

  try {
    // Si searchTerm está presente, realizamos búsqueda semántica (embedding) + LIKE
    let sql = `SELECT c.* ${searchTerm ? ", me.embedding" : ""} FROM conversations c`;
    if (searchTerm) {
      sql += ` JOIN message_embeddings me ON c.id = me.message_id`;
    }

    const dbParams = [];
    const whereClauses = [];

    if (project) {
      whereClauses.push(`c.project = ?`);
      dbParams.push(project);
    }

    if (searchTerm) {
      whereClauses.push(`c.content LIKE ?`);
      dbParams.push(`%${searchTerm}%`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(` AND `);
    }

    const rows = await db.allAsync(sql, dbParams);
    
    // Si no hay búsqueda semántica pedida (podríamos decidir si searchTerm siempre implica búsqueda semántica)
    // Actualmente el código original hacía embedding SI query existía. Mantendremos esa lógica adaptada.
    if (!searchTerm) {
      return rows;
    }

    // Aquí mantenemos la lógica original de semejanza si searchTerm existe
    const queryEmbeddingJson = await generateEmbedding(searchTerm);
    const queryEmbedding = JSON.parse(queryEmbeddingJson);

    if (!Array.isArray(queryEmbedding)) {
      throw new Error("No se pudo generar el embedding valido para la consulta.");
    }

    const scoredResults = rows.map((row) => {
      const embedding = JSON.parse(row.embedding);
      const similarity = calculateCosineSimilarity(queryEmbedding, embedding);
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

module.exports = searchMessages;
