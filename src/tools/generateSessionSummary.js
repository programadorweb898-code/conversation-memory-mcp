const db = require("../database");

/**
 * Genera un resumen de una sesion concatenando los contenidos de los mensajes.
 * En una implementacion futura, esto podria usar un LLM o tecnicas mas avanzadas.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesion para resumir.
 * @returns {Promise<string>} - El resumen generado de la sesion.
 */
async function generateSessionSummary({ sessionId }) {
  try {
    const rows = await db.allAsync(
      `SELECT role, content FROM conversations WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC`,
      [sessionId]
    );

    if (rows.length === 0) {
      return "No hay mensajes en esta sesion para resumir.";
    }

    return rows
      .map((row) => `${row.role}: ${row.content}`)
      .join("");
  } catch (err) {
    console.error("Error generating session summary:", err.message);
    throw err;
  }
}

module.exports = generateSessionSummary;
