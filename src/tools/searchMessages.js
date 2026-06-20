const { db, dbReadyPromise } = require("../database");
const { z } = require("zod");
const { generateEmbedding, calculateCosineSimilarity } = require("../services/embeddingService");
const removeStopwords = require("../services/stopwords");

const SearchMessagesSchema = z.object({
  searchTerm: z.string().optional(),
  query: z.string().optional(),
  project: z.string().optional(),
  threshold: z.number().min(0).max(1).optional().default(0.6),
}).refine(data => data.searchTerm || data.query || data.project, {
  message: "Se requiere al menos uno de: searchTerm, query o project",
});

/**
 * Busca mensajes en la base de datos usando un enfoque híbrido.
 */
async function searchMessages(params) {
  await dbReadyPromise;
  const validatedParams = SearchMessagesSchema.parse(params);
  const { project, threshold } = validatedParams;
  const searchTerm = validatedParams.searchTerm || validatedParams.query;

  try {
    // Obtenemos todos los mensajes candidatos. 
    // Si hay searchTerm, traemos también los embeddings.
    let sql = `SELECT c.* ${searchTerm ? ", me.embedding" : ""} FROM conversations c`;
    if (searchTerm) {
      sql += ` LEFT JOIN message_embeddings me ON c.id = me.message_id`;
    }

    const dbParams = [];
    const whereClauses = [];

    if (project) {
      whereClauses.push(`c.project = ?`);
      dbParams.push(project);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(` AND `);
    }

    const rows = await db.allAsync(sql, dbParams);
    
    // Si no hay búsqueda semántica, devolvemos filtrado por proyecto
    if (!searchTerm) {
      return rows;
    }

    // --- RERANKING HÍBRIDO ---
    // Limpiamos el término de búsqueda de stopwords para el embedding semántico
    const semanticSearchTerm = removeStopwords(searchTerm);
    const queryTokens = semanticSearchTerm
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2);
    
    // Pasamos un objeto mensaje simulado para que coincida con el formato enriquecido
    const queryEmbeddingJson = await generateEmbedding({ role: "query", content: semanticSearchTerm });
    const queryEmbedding = JSON.parse(queryEmbeddingJson);

    const scoredResults = rows.map((row) => {
      // 1. Score Semántico (0 a 1)
      let semanticScore = 0;
      if (row.embedding) {
        const embedding = JSON.parse(row.embedding);
        semanticScore = calculateCosineSimilarity(queryEmbedding, embedding);
      }

      // 2. Score Léxico (0 o 1)
      const contentLower = row.content.toLowerCase();
      const matchedTokens = queryTokens.filter((token) => contentLower.includes(token));
      const lexicalScore = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0;

      // 3. Score Compuesto (Pesos: 70% semántico, 30% léxico)
      const finalScore = (semanticScore * 0.7) + (lexicalScore * 0.3);

      return { ...row, similarity: finalScore, lexicalScore, semanticScore };
    });

    return scoredResults
      .filter((result) => result.lexicalScore > 0 || result.semanticScore >= threshold)
      .sort((a, b) => b.similarity - a.similarity);
  } catch (err) {
    console.error("Error searching messages:", err.message);
    throw err;
  }
}

module.exports = searchMessages;
