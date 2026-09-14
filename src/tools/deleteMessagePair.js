const { db } = require("../database");

/**
 * Elimina un mensaje y su mensaje relacionado (pregunta o respuesta)
 * basandose en el ID proporcionado.
 * @param {string} messageId - El ID del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessagePair({ messageId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    const targetMessage = await db.getAsync(
      "SELECT id, related_message_id FROM conversations WHERE id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
      [messageId, project, owner ?? null]
    );

    if (!targetMessage) {
      console.log(`Message ${messageId} not found in project ${project}.`);
      return;
    }

    // Buscar el par: o el mensaje actual apunta a otro, o otro apunta al actual
    const pairMessage = await db.getAsync(
      "SELECT id FROM conversations WHERE (id = $1 OR related_message_id = $2 AND id != $3) AND project = $4 AND ($5::text IS NULL OR owner = $5)",
      [targetMessage.related_message_id, messageId, messageId, project, owner ?? null]
    );

    const idsToDelete = [messageId];
    if (pairMessage) idsToDelete.push(pairMessage.id);

    const placeholders = idsToDelete.map((_, i) => "$" + (i + 1)).join(",");
    await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (${placeholders})`, idsToDelete);
    await db.runAsync(`DELETE FROM conversations WHERE id IN (${placeholders}) AND project = $${idsToDelete.length + 1} AND ($${idsToDelete.length + 2}::text IS NULL OR owner = $${idsToDelete.length + 2})`, [...idsToDelete, project, owner ?? null]);

    console.log(`Message pair ${idsToDelete.join(", ")} deleted.`);
  } catch (err) {
    console.error("Error deleting message pair:", err.message);
    throw err;
  }
}

module.exports = deleteMessagePair;
