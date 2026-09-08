const { db } = require("../database");
const { z } = require("zod");
const { generateEmbedding } = require("../services/embeddingService");
const removeStopwords = require("../services/stopwords");
const { lexicalSearch, countEmbeddings } = require("../services/lexicalSearch");

const SearchMessagesSchema = z.object({
  searchTerm: z.string().optional(),
  query: z.string().optional(),
  project: z.string().min(1),
  agentId: z.string().optional(),
  threshold: z.number().min(0).max(1).optional().default(0.6),
});

/**
 * Busca mensajes en la base de datos usando un enfoque híbrido.
 * La búsqueda semántica (pgvector) se usa cuando existen embeddings indexados;
 * si no los hay (o no producen coincidencias), cae a una búsqueda léxica
 * (ILIKE) para que el conocimiento siempre sea recuperable por cualquier agente.
 */
async function searchMessages(params) {
  const validatedParams = SearchMessagesSchema.parse(params);
  const { project, agentId, threshold } = validatedParams;
  const searchTerm = validatedParams.searchTerm || validatedParams.query;

  try {
    // Si no hay búsqueda semántica, devolvemos filtrado por proyecto y/o agente
    if (!searchTerm) {
      let sql = `SELECT c.* FROM conversations c`;
      const dbParams = [];
      const whereClauses = [];

      if (project) {
        dbParams.push(project);
        whereClauses.push(`c.project = $${dbParams.length}`);
      }

      if (agentId) {
        dbParams.push(agentId);
        whereClauses.push(`c.agent_id = $${dbParams.length}`);
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ` + whereClauses.join(` AND `);
      }

      return await db.allAsync(sql, dbParams);
    }

    const semanticSearchTerm = removeStopwords(searchTerm);
    const queryTokens = semanticSearchTerm
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2);

    const fallbackToLexical = async () => {
      const rows = await lexicalSearch({ searchTerm, project, agentId });
      return rows.map((row) => {
        const lexicalScore = Number(row.lexical_score) || 0;
        const normalized = queryTokens.length > 0 ? lexicalScore / queryTokens.length : lexicalScore;
        return {
          ...row,
          lexicalScore,
          semanticScore: 0,
          similarity: normalized,
        };
      });
    };

    // Sin embeddings indexados no hay vía semántica posible: respondemos con
    // búsqueda léxica sin cargar el modelo (rápida y siempre disponible).
    const embeddingCount = await countEmbeddings(project, agentId);
    if (embeddingCount === 0) {
      return await fallbackToLexical();
    }

    // --- RERANKING HÍBRIDO ---
    // Pasamos un objeto mensaje simulado para que coincida con el formato enriquecido
    const queryEmbeddingJson = await generateEmbedding({ role: "query", content: semanticSearchTerm });

    // pgvector: el operador <=> calcula la distancia de coseno.
    // La similitud de coseno se obtiene con: 1 - distancia_coseno
    let sql = `
      SELECT c.*, (1 - (me.embedding <=> $1::vector)) AS semantic_score
      FROM conversations c
      INNER JOIN message_embeddings me ON c.id = me.message_id
    `;

    const dbParams = [queryEmbeddingJson];
    const whereClauses = [];

    if (project) {
      dbParams.push(project);
      whereClauses.push(`c.project = $${dbParams.length}`);
    }

    if (agentId) {
      dbParams.push(agentId);
      whereClauses.push(`c.agent_id = $${dbParams.length}`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(` AND `);
    }

    // Ordenamos por distancia de coseno ascendente (mayor similitud primero) y limitamos a los top 100
    sql += ` ORDER BY me.embedding <=> $1::vector ASC LIMIT 100`;

    const rows = await db.allAsync(sql, dbParams);

    const scoredResults = rows.map((row) => {
      // 1. Score Semántico viene ya calculado de Postgres
      const semanticScore = parseFloat(row.semantic_score) || 0;

      // 2. Score Léxico (0 o 1)
      const contentLower = row.content.toLowerCase();
      const matchedTokens = queryTokens.filter((token) => contentLower.includes(token));
      const lexicalScore = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0;

      // 3. Score Compuesto (Pesos: 70% semántico, 30% léxico)
      const finalScore = (semanticScore * 0.7) + (lexicalScore * 0.3);

      return { ...row, similarity: finalScore, lexicalScore, semanticScore };
    });

    const filteredResults = scoredResults
      .filter((result) => result.lexicalScore > 0 || result.semanticScore >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    // Los embeddings existen pero no aportaron coincidencias: igual respondemos
    // con coincidencias léxicas antes de devolver vacío.
    if (filteredResults.length > 0) {
      return filteredResults;
    }
    return await fallbackToLexical();
  } catch (err) {
    console.error("Error searching messages:", err.message);
    throw err;
  }
}


module.exports = searchMessages;
