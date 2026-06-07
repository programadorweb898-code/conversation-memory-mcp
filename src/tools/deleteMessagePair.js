const db = require("../database");

/**
 * Elimina un mensaje y su mensaje relacionado (pregunta o respuesta) 
 * basándose en el ID proporcionado.
 * @param {string} messageId - El ID del mensaje a eliminar.
 * @returns {Promise<void>}
 */
async function deleteMessagePair(messageId) {
  return new Promise((resolve, reject) => {
    // 1. Encontrar el ID del mensaje relacionado primero
    db.get("SELECT session_id, id FROM conversations WHERE id = ?", [messageId], (err, targetMessage) => {
      if (err) return reject(err);
      if (!targetMessage) {
        console.log(`Message ${messageId} not found.`);
        return resolve();
      }

      // Supongamos que la estructura nos permite encontrar el par (p.ej. mensaje anterior o siguiente)
      // Como no hay un campo 'parent_id', buscaremos el mensaje más cercano en la misma sesión.
      // Esta es una heurística: buscar el mensaje inmediatamente anterior o posterior.
      db.all("SELECT id FROM conversations WHERE session_id = ? ORDER BY timestamp ASC", [targetMessage.session_id], (err, messages) => {
        if (err) return reject(err);

        const index = messages.findIndex(m => m.id === messageId);
        let idsToDelete = [messageId];

        // Añadir el vecino (pregunta o respuesta) a la lista
        if (index > 0) idsToDelete.push(messages[index - 1].id);
        else if (index < messages.length - 1) idsToDelete.push(messages[index + 1].id);

        // 2. Eliminar embeddings y mensajes
        const placeholders = idsToDelete.map(() => '?').join(',');
        
        db.serialize(() => {
          db.run(`DELETE FROM message_embeddings WHERE message_id IN (${placeholders})`, idsToDelete, (err) => {
            if (err) return reject(err);
            
            db.run(`DELETE FROM conversations WHERE id IN (${placeholders})`, idsToDelete, (err) => {
              if (err) return reject(err);
              console.log(`Message pair ${idsToDelete.join(', ')} deleted.`);
              resolve();
            });
          });
        });
      });
    });
  });
}

module.exports = deleteMessagePair;
