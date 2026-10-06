const { withTransaction } = require("../database");

/**
 * Elimina todos los mensajes, embeddings y el resumen
 * asociados para una sesión específica.
 * @param {string} sessionId - El ID único de la sesión a eliminar.
 * @param {string} project - Proyecto de la sesión.
 * @param {string} [owner] - Propietario autenticado; si se omite, aplica al proyecto completo.
 * @returns {Promise<void>}
 */
async function deleteSession({ sessionId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  try {
    const result = await withTransaction(async (tx) => {
      const embeddingResult = await tx.runAsync(
        "DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3))",
        [sessionId, project, owner ?? null]
      );

      const messageResult = await tx.runAsync(
        "DELETE FROM conversations WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
        [sessionId, project, owner ?? null]
      );

      const summaryResult = await tx.runAsync(
        "DELETE FROM session_summaries WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
        [sessionId, project, owner ?? null]
      );

      return {
        embeddings: embeddingResult.changes,
        messages: messageResult.changes,
        summaries: summaryResult.changes,
      };
    });

    if (result.messages > 0 || result.summaries > 0) {
      console.log(
        `Session ${sessionId} and its associated data deleted successfully. ` +
        `Rows affected: messages=${result.messages}, summaries=${result.summaries}, embeddings=${result.embeddings}`
      );
    } else {
      console.log(`Session ${sessionId} not found or had no associated data.`);
    }
  } catch (err) {
    console.error("Error deleting session:", err.message);
    throw err;
  }
}

module.exports = deleteSession;
