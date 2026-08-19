const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");

/**
 * Guarda o actualiza el resumen de una sesión específica y su embedding.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión.
 * @param {string} params.summary - El resumen generado.
 * @param {string} params.lastProcessedSeqId - El ID secuencial del último mensaje procesado.
 * @returns {Promise<boolean>}
 */
async function saveSessionSummary({ sessionId, project, summary, lastProcessedSeqId }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const existingSessionProject = await db.getAsync(
      `SELECT project FROM conversations WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );
    if (existingSessionProject && existingSessionProject.project !== project) {
      const error = new Error(
        `La sesión ${sessionId} ya pertenece al proyecto "${existingSessionProject.project}". No se permite mezclar datos entre proyectos.`
      );
      error.code = "PROJECT_CONFLICT";
      throw error;
    }

    const sql = `
      INSERT INTO session_summaries (session_id, project, summary, last_processed_seq_id, timestamp)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        project = EXCLUDED.project,
        summary = EXCLUDED.summary,
        last_processed_seq_id = EXCLUDED.last_processed_seq_id,
        timestamp = EXCLUDED.timestamp
    `;

    await db.runAsync(sql, [sessionId, project, summary, lastProcessedSeqId]);

    // Generar y guardar el embedding del resumen
    const embedding = await generateEmbedding({ role: "session_summary", content: summary });
    
    // Guardar el embedding usando el sessionId como identificador único
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, embedding) VALUES ($1, $2)
       ON CONFLICT(session_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [sessionId, embedding]
    );

    return true;
  } catch (err) {
    console.error("Error saving session summary and embedding:", err.message);
    throw err;
  }
}

module.exports = saveSessionSummary;
