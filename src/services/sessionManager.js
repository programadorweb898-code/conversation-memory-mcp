const { db } = require("../database");
const finalizeSession = require("../tools/finalizeSession");

const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL_MS = 1 * 60 * 1000; // Revisar cada minuto

async function checkAndFinalizeInactiveSessions() {
  console.log("Revisando sesiones inactivas para finalización automática...");

  try {
    // 1. Buscar solo las sesiones que aún podrían necesitar un finalize: las que
    // nunca tuvieron resumen, o las que tienen mensajes nuevos por encima del
    // último sequence_id ya resumido.
    const activeSessions = await db.allAsync(`
      SELECT c.session_id, MAX(c.timestamp) AS last_activity
      FROM conversations c
      LEFT JOIN session_summaries ss ON ss.session_id = c.session_id
      WHERE ss.session_id IS NULL
        OR COALESCE(c.sequence_id, -1) > COALESCE(ss.last_processed_seq_id, -1)
      GROUP BY c.session_id
    `);

// ...
    const now = Date.now();

    for (const session of activeSessions) {
      const lastActivityTime = new Date(session.last_activity).getTime();
      const idleTime = now - lastActivityTime;

      if (idleTime > INACTIVITY_THRESHOLD_MS) {
        console.log(`Sesión ${session.session_id} inactiva por ${Math.round(idleTime/1000)}s. Finalizando...`);
        try {
          await finalizeSession(session.session_id);
          console.log(`Sesión ${session.session_id} finalizada automáticamente.`);
        } catch (error) {
          console.error(`Error al finalizar sesión ${session.session_id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error("Error en el monitor de sesiones inactivas:", error.message);
  }
}

let sessionMonitorInterval;

function startSessionMonitor() {
  console.log("Iniciando monitor de inactividad de sesiones (5 min)...");
  // No ejecutar al inicio - lazy load para que Gemini CLI se conecte inmediatamente
  // La primera ejecución será después de CHECK_INTERVAL_MS
  sessionMonitorInterval = setInterval(checkAndFinalizeInactiveSessions, CHECK_INTERVAL_MS);
}

function stopSessionMonitor() {
  if (sessionMonitorInterval) {
    clearInterval(sessionMonitorInterval);
    console.log("Monitor de inactividad de sesiones detenido.");
  }
}

module.exports = {
  startSessionMonitor,
  stopSessionMonitor
};
