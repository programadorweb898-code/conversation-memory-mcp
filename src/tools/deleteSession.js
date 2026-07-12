const { db } = require("../database");

/**
 * Elimina todos los mensajes y sus embeddings asociados para una sesion especifica.
 * @param {string} sessionId - El ID unico de la sesion a eliminar.
 * @returns {Promise<void>}
 */
// Orden obligatorio: message_embeddings depende de conversations; conversations depende de la sesión.
// Por eso se borran primero los embeddings de mensajes, luego los mensajes, y al final los summaries.
async function deleteSession(sessionId) {
  try {
    const embeddingResult = await db.runAsync(
      "DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)",
      [sessionId]
    );
    console.log(`Embeddings for session ${sessionId} deleted (if existed). Rows affected: ${embeddingResult.changes}`);

    const messageResult = await db.runAsync("DELETE FROM conversations WHERE session_id = $1", [sessionId]);
    console.log(`Messages for session ${sessionId} deleted (if existed). Rows affected: ${messageResult.changes}`);

    const summaryResult = await db.runAsync("DELETE FROM session_summaries WHERE session_id = $1", [sessionId]);
    if (messageResult.changes > 0 || summaryResult.changes > 0) {
      console.log(`Session ${sessionId} and its messages deleted successfully. Rows affected: messages=${messageResult.changes}, summaries=${summaryResult.changes}`);
    } else {
      console.log(`Session ${sessionId} not found or had no messages.`);
    }
  } catch (err) {
    console.error("Error deleting session:", err.message);
    throw err;
  }
}

module.exports = deleteSession;
