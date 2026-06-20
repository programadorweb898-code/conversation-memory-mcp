const { db, dbReadyPromise } = require("../database");

/**
 * Recupera el contenido de un mensaje especifico y su contexto para ser guardado en Engram.
 * @param {Object} params
 * @param {string} params.messageId - El ID del mensaje a recuperar.
 * @returns {Promise<Object>} - El contenido del mensaje y su contexto.
 */
async function pushToEngram({ messageId }) {
  await dbReadyPromise;
  try {
    const sql = `
      SELECT c.*
      FROM conversations c
      WHERE c.id = ?
    `;
    const row = await db.getAsync(sql, [messageId]);

    if (!row) {
      throw new Error("Mensaje no encontrado");
    }

    return {
      message: row,
      suggestion: {
        title: `Contexto desde sesion ${row.session_id}`,
        content: `**What**: ${row.content.substring(0, 50)}...\n**Why**: Historial de conversacion\n**Where**: Sesion ${row.session_id}\n**Learned**: -`,
        type: "manual",
      },
    };
  } catch (err) {
    console.error("Error pushing message to Engram:", err.message);
    throw err;
  }
}

module.exports = pushToEngram;
