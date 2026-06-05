const db = require("../database");

/**
 * Recupera el contenido de un mensaje específico para ser guardado en Engram.
 * @param {Object} params
 * @param {string} params.messageId - El ID del mensaje a recuperar.
 * @returns {Promise<Object>} - El contenido del mensaje.
 */
async function pushToEngram({ messageId }) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM conversations WHERE id = ?`;
    
    db.get(sql, [messageId], (err, row) => {
      if (err) {
        reject(err);
      } else if (!row) {
        reject(new Error("Mensaje no encontrado"));
      } else {
        resolve(row);
      }
    });
  });
}

module.exports = pushToEngram;
