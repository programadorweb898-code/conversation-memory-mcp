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
      "SELECT id, related_message_id FROM conversations WHERE id = $1",
      [messageId]
    );

    if (!targetMessage) {
      console.log(`Message ${messageId} not found.`);
      return;
    }

    // Buscar el par: o el mensaje actual apunta a otro, o otro apunta al actual
    const pairMessage = await db.getAsync(
      "SELECT id FROM conversations WHERE id = $1 OR related_message_id = $2 AND id != $3",
      [targetMessage.related_message_id, messageId, messageId]
    );

    const idsToDelete = [messageId];
    if (pairMessage) idsToDelete.push(pairMessage.id);

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
