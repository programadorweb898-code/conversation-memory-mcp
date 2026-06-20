const { db, dbReadyPromise } = require("../database");

/**
 * Elimina un mensaje especifico y su embedding asociado de la base de datos.
 * @param {string} messageId - El ID unico del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessage(messageId) {
  await dbReadyPromise;
  try {
    await db.runAsync("DELETE FROM message_embeddings WHERE message_id = ?", [messageId]);
    console.log(`Embedding for message ${messageId} deleted (if existed).`);

    const result = await db.runAsync("DELETE FROM conversations WHERE id = ?", [messageId]);
    if (result.changes > 0) {
      console.log(`Message ${messageId} deleted successfully.`);
    } else {
      console.log(`Message ${messageId} not found.`);
    }
  } catch (err) {
    console.error("Error deleting message:", err.message);
    throw err;
  }
}

module.exports = deleteMessage;
