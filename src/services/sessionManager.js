const db = require("../database");
const finalizeSession = require("../tools/finalizeSession");
const getSessionSummary = require("../tools/getSessionSummary");

const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL_MS = 1 * 60 * 1000; // Revisar cada minuto

async function checkAndFinalizeInactiveSessions() {
  console.log("Revisando sesiones inactivas para finalización automática...");
  
  try {
    // 1. Buscar las últimas sesiones activas (mensajes en la última hora por eficiencia)
    // que no tengan un resumen ya guardado en session_summaries.
    const activeSessions = await db.allAsync(`
      SELECT session_id, MAX(timestamp) as last_activity
      FROM conversations
      WHERE session_id NOT IN (SELECT session_id FROM session_summaries)
      GROUP BY session_id
    `);

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
  // Ejecutar una vez al inicio y luego cada intervalo
  checkAndFinalizeInactiveSessions();
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
