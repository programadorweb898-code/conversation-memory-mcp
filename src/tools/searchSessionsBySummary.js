const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");

/**
 * Busca sesiones relevantes basándose en un resumen semántico y recupera su historial completo.
 * @param {Object} params
 * @param {string} params.query - La pregunta del usuario.
 * @returns {Promise<Array>} El historial completo de la(s) sesión(es) encontrada(s).
 */
async function searchSessionsBySummary({ query, project }) {
  if (!query) throw new Error("La consulta no puede estar vacía.");
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  // 1. Generar embedding de la consulta del usuario
  const queryEmbeddingJson = await generateEmbedding({ role: "search", content: query });

  // 2. Buscar las sesiones cuyos resúmenes sean semánticamente similares (distancia coseno)
  // Restringido al proyecto para aislar los datos.
  // Ordenamos por similitud (menor distancia = mayor similitud)
  const sql = `
    SELECT
      sse.session_id,
      (1 - (sse.embedding <=> $1::vector)) AS similarity
    FROM session_summary_embeddings AS sse
    JOIN session_summaries AS ss ON ss.session_id = sse.session_id
    WHERE ss.project = $2
    ORDER BY sse.embedding <=> $1::vector ASC
    LIMIT 1
  `;
  
  const results = await db.allAsync(sql, [queryEmbeddingJson, project]);

  if (results.length === 0) {
    return [];
  }

  const bestSessionId = results[0].session_id;
  console.log(`Sesión encontrada mediante resumen: ${bestSessionId} (Similitud: ${results[0].similarity})`);

  // 3. Recuperar todo el historial de la sesión identificada
  const historySql = `
    SELECT id, session_id, timestamp, project, role, content 
    FROM conversations 
    WHERE session_id = $1 AND project = $2
    ORDER BY timestamp ASC
  `;
  
  const history = await db.allAsync(historySql, [bestSessionId, project]);

  return history;
}

module.exports = searchSessionsBySummary;
