const { db } = require("../database");

/**
 * Elimina todos los mensajes, embeddings, summaries y candidatos de memoria
 * asociados para una sesión específica.
 * @param {string} sessionId - El ID único de la sesión a eliminar.
 * @param {string} project - Proyecto de la sesión.
 * @param {string} [owner] - Propietario autenticado; si se omite, aplica al proyecto completo.
 * @returns {Promise<void>}
 */
// Orden obligatorio: message_embeddings depende de conversations; conversations
// y memory_candidates son recursos de la sesión y deben limpiarse explícitamente.
async function deleteSession({ sessionId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const embeddingResult = await db.runAsync(
      "DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3))",
      [sessionId, project, owner ?? null]
    );
    console.log(`Embeddings for session ${sessionId} deleted (if existed). Rows affected: ${embeddingResult.changes}`);

    const messageResult = await db.runAsync(
      "DELETE FROM conversations WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
      [sessionId, project, owner ?? null]
    );
    console.log(`Messages for session ${sessionId} deleted (if existed). Rows affected: ${messageResult.changes}`);

    const summaryResult = await db.runAsync(
      "DELETE FROM session_summaries WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
      [sessionId, project, owner ?? null]
    );

    const candidateResult = await db.runAsync(
      "DELETE FROM memory_candidates WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
      [sessionId, project, owner ?? null]
    );

    if (messageResult.changes > 0 || summaryResult.changes > 0 || candidateResult.changes > 0) {
      console.log(
        `Session ${sessionId} and its associated data deleted successfully. ` +
        `Rows affected: messages=${messageResult.changes}, summaries=${summaryResult.changes}, candidates=${candidateResult.changes}`
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
