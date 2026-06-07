const db = require("../database");

/**
 * Genera un resumen de una sesión concatenando los contenidos de los mensajes.
 * En una implementación futura, esto podría usar un LLM o técnicas más avanzadas.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión para resumir.
 * @returns {Promise<string>} - El resumen generado de la sesión.
 */
async function generateSessionSummary({ sessionId }) {
  return new Promise((resolve, reject) => {
    // Recuperar todos los mensajes de la sesión
    db.all(
      `SELECT role, content FROM conversations WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId],
      (err, rows) => {
        if (err) {
          return reject(err);
        }

        if (rows.length === 0) {
          return resolve("No hay mensajes en esta sesión para resumir.");
        }

        // Concatenar mensajes para un resumen simple
        const summary = rows
          .map((row) => `${row.role}: ${row.content}`)
          .join("
");

        resolve(summary);
      }
    );
  });
}

module.exports = generateSessionSummary;
