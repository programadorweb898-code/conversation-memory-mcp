const db = require("../database");

/**
 * Elimina un mensaje específico y su embedding asociado de la base de datos.
 * @param {string} messageId - El ID único del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessage(messageId) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Eliminar de message_embeddings primero debido a la clave foránea
      db.run("DELETE FROM message_embeddings WHERE message_id = ?", [messageId], function(err) {
        if (err) {
          console.error("Error deleting embedding:", err.message);
          return reject(err);
        }
        console.log(`Embedding for message ${messageId} deleted (if existed).`);

        // Luego eliminar de conversations
        db.run("DELETE FROM conversations WHERE id = ?", [messageId], function(err) {
          if (err) {
            console.error("Error deleting message:", err.message);
            return reject(err);
          }
          if (this.changes > 0) {
            console.log(`Message ${messageId} deleted successfully.`);
            resolve();
          } else {
            console.log(`Message ${messageId} not found.`);
            resolve(); // Resuelve incluso si no se encuentra, la intención es que no esté.
          }
        });
      });
    });
  });
}

module.exports = deleteMessage;
