const db = require("../database");

/**
 * Recupera el contenido de un mensaje específico y su contexto para ser guardado en Engram.
 * @param {Object} params
 * @param {string} params.messageId - El ID del mensaje a recuperar.
 * @returns {Promise<Object>} - El contenido del mensaje y su contexto.
 */
async function pushToEngram({ messageId }) {
  return new Promise((resolve, reject) => {
    // Recuperar el mensaje y el contexto de sesión
    const sql = `
      SELECT c.*, s.id as session_id 
      FROM conversations c
      JOIN sessions s ON c.session_id = s.id
      WHERE c.id = ?
    `;
    
    db.get(sql, [messageId], (err, row) => {
      if (err) {
        reject(err);
      } else if (!row) {
        reject(new Error("Mensaje no encontrado"));
      } else {
        // Devolver una estructura que facilite el mem_save
        resolve({
          message: row,
          suggestion: {
            title: `Contexto desde sesión ${row.session_id}`,
            content: `**What**: ${row.content.substring(0, 50)}...\n**Why**: Historial de conversación\n**Where**: Sesión ${row.session_id}\n**Learned**: -`,
            type: 'manual'
          }
        });
      }
    });
  });
}

module.exports = pushToEngram;
