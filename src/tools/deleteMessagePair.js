const { db } = require("../database");

/**
 * Elimina un mensaje y su mensaje relacionado (pregunta o respuesta)
 * basandose en el ID proporcionado.
 * @param {string} messageId - El ID del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessagePair(messageId) {
  try {
    const targetMessage = await db.getAsync(
      "SELECT session_id, id FROM conversations WHERE id = $1",
      [messageId]
    );

    if (!targetMessage) {
      console.log(`Message ${messageId} not found.`);
      return;
    }

    const messages = await db.allAsync(
      "SELECT id FROM conversations WHERE session_id = $1 ORDER BY timestamp ASC, ctid ASC",
      [targetMessage.session_id]
    );

    const index = messages.findIndex((message) => message.id === messageId);
    const idsToDelete = [messageId];

    if (index > 0) idsToDelete.push(messages[index - 1].id);
    else if (index < messages.length - 1) idsToDelete.push(messages[index + 1].id);

    const placeholders = idsToDelete.map((_, i) => "$" + (i + 1)).join(",");
    await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (${placeholders})`, idsToDelete);
    await db.runAsync(`DELETE FROM conversations WHERE id IN (${placeholders})`, idsToDelete);

    console.log(`Message pair ${idsToDelete.join(", ")} deleted.`);
  } catch (err) {
    console.error("Error deleting message pair:", err.message);
    throw err;
  }
}

module.exports = deleteMessagePair;
