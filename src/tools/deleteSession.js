const { db, dbReadyPromise } = require("../database");

/**
 * Elimina todos los mensajes y sus embeddings asociados para una sesion especifica.
 * @param {string} sessionId - El ID unico de la sesion a eliminar.
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId) {
  await dbReadyPromise;
  try {
    const embeddingResult = await db.runAsync(
      "DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = ?)",
      [sessionId]
    );
    console.log(`Embeddings for session ${sessionId} deleted (if existed). Rows affected: ${embeddingResult.changes}`);

    const messageResult = await db.runAsync("DELETE FROM conversations WHERE session_id = ?", [sessionId]);
    if (messageResult.changes > 0) {
      console.log(`Session ${sessionId} and its messages deleted successfully. Rows affected: ${messageResult.changes}`);
    } else {
      console.log(`Session ${sessionId} not found or had no messages.`);
    }
  } catch (err) {
    console.error("Error deleting session:", err.message);
    throw err;
  }
}

module.exports = deleteSession;
