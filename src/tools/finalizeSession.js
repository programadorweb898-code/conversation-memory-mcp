const generateSessionSummary = require("./generateSessionSummary");
const saveSessionSummary = require("./saveSessionSummary");
const { db } = require("../database");

async function finalizeSession(sessionId) {
  console.log(`Finalizando sesión: ${sessionId}`);
  
  // 1. Obtener resumen previo y el ID del último mensaje procesado
  const existingSummary = await db.getAsync(
    "SELECT summary, last_processed_message_id FROM session_summaries WHERE session_id = $1",
    [sessionId]
  );

  // 2. Obtener mensajes nuevos (delta)
  let query = `
    SELECT id, role, content, timestamp 
    FROM conversations 
    WHERE session_id = $1
  `;
  const params = [sessionId];
  
  if (existingSummary && existingSummary.last_processed_message_id) {
    query += " AND id > $2";
    params.push(existingSummary.last_processed_message_id);
  }
  
  query += " ORDER BY timestamp ASC, ctid ASC";
  
  const newMessages = await db.allAsync(query, params);

  if (newMessages.length === 0 && existingSummary) {
    console.log("No hay mensajes nuevos para resumir.");
    return { summary: existingSummary.summary, auditRequired: false };
  }

  // 3. Generar resumen incremental
  const summary = await generateSessionSummary({ 
    sessionId, 
    previousSummary: existingSummary ? existingSummary.summary : null,
    newMessages 
  });
  
  // 4. Guardar nuevo resumen y actualizar el ID del último mensaje
  const lastMessageId = newMessages.length > 0 ? newMessages[newMessages.length - 1].id : existingSummary.last_processed_message_id;
  
  await saveSessionSummary({ sessionId, summary, lastProcessedMessageId: lastMessageId });
  
  return { summary, auditRequired: true };
}

module.exports = finalizeSession;
