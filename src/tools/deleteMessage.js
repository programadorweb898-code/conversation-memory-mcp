const { db } = require("../database");

/**
 * Elimina un mensaje especifico y su embedding asociado de la base de datos.
 * @param {string} messageId - El ID unico del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessage({ messageId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  try {
    await db.runAsync(
      "DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3))",
      [messageId, project, owner ?? null]
    );
    console.log(`Embedding for message ${messageId} deleted (if existed).`);

    const result = await db.runAsync("DELETE FROM conversations WHERE id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)", [messageId, project, owner ?? null]);
    if (result.changes > 0) {
      console.log(`Message ${messageId} deleted successfully.`);
    } else {
      console.log(`Message ${messageId} not found.`);
    }
  } catch (err) {
    if (err.code === '23503') {
      const friendlyError = new Error("No se puede eliminar el mensaje porque está siendo referenciado por otros mensajes.");
      friendlyError.code = 'FK_VIOLATION';
      throw friendlyError;
    }
    console.error("Error deleting message:", err.message);
    throw err;
  }
}

module.exports = deleteMessage;
