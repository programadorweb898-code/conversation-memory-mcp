const db = require("../database");

/**
 * Elimina todos los mensajes y sus embeddings asociados para una sesión específica.
 * @param {string} sessionId - El ID único de la sesión a eliminar.
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Eliminar de message_embeddings primero debido a la clave foránea
      db.run("DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = ?)", [sessionId], function(err) {
        if (err) {
          console.error("Error deleting embeddings for session:", err.message);
          return reject(err);
        }
        console.log(`Embeddings for session ${sessionId} deleted (if existed). Rows affected: ${this.changes}`);

        // Luego eliminar de conversations
        db.run("DELETE FROM conversations WHERE session_id = ?", [sessionId], function(err) {
          if (err) {
            console.error("Error deleting messages for session:", err.message);
            return reject(err);
          }
          if (this.changes > 0) {
            console.log(`Session ${sessionId} and its messages deleted successfully. Rows affected: ${this.changes}`);
            resolve();
          } else {
            console.log(`Session ${sessionId} not found or had no messages.`);
            resolve(); // Resuelve incluso si no se encuentra o no tiene mensajes.
          }
        });
      });
    });
  });
}

module.exports = deleteSession;
