const db = require("../database");

/**
 * Genera un resumen estructurado de una sesión.
 * @param {Object} params
 * @param {string} params.sessionId - El ID de la sesión para resumir.
 * @returns {Promise<string>} - El resumen formateado.
 */
async function generateSessionSummary({ sessionId }) {
  try {
    const rows = await db.allAsync(
      `SELECT role, content, timestamp, project FROM conversations 
       WHERE session_id = ? 
       ORDER BY timestamp ASC, rowid ASC`,
      [sessionId]
    );

    if (rows.length === 0) {
      return "No hay mensajes en esta sesión para resumir.";
    }

    const firstMsg = rows[0];
    const lastMsg = rows[rows.length - 1];
    const project = firstMsg.project || "Sin proyecto";
    const startTime = new Date(firstMsg.timestamp).toLocaleString();
    const endTime = new Date(lastMsg.timestamp).toLocaleString();

    let summary = `=== RESUMEN DE SESIÓN ===\n`;
    summary += `ID: ${sessionId}\n`;
    summary += `Proyecto: ${project}\n`;
    summary += `Inicio: ${startTime}\n`;
    summary += `Fin: ${endTime}\n`;
    summary += `Total mensajes: ${rows.length}\n`;
    summary += `=========================\n\n`;
    summary += `TRANSCRIPCIÓN:\n`;

    const transcript = rows
      .map((row) => `[${new Date(row.timestamp).toLocaleTimeString()}] ${row.role.toUpperCase()}: ${row.content}`)
      .join("\n");

    return summary + transcript;
  } catch (err) {
    console.error("Error generating session summary:", err.message);
    throw err;
  }
}

module.exports = generateSessionSummary;
