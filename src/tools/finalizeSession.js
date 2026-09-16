const generateSessionSummary = require("./generateSessionSummary");
const saveSessionSummary = require("./saveSessionSummary");
const { db } = require("../database");

async function finalizeSession({ sessionId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  console.log(`Finalizando sesión: ${sessionId}`);

  // 1. Obtener resumen previo y el ID del último mensaje procesado. El resumen
  // queda aislado por owner (token master no filtra, owner null).
  const existingSummary = await db.getAsync(
    "SELECT summary, last_processed_seq_id FROM session_summaries WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)",
    [sessionId, project, owner ?? null]
  );

  // 2. Obtener mensajes nuevos (delta). El orden por sequence_id garantiza que
  // el último mensaje procesado sea realmente el de mayor secuencia, sin
  // depender de timestamp ni de ctid.
  let query = `
    SELECT id, sequence_id, role, content, timestamp
    FROM conversations
    WHERE session_id = $1 AND project = $2 AND ($3::text IS NULL OR owner = $3)
  `;
  const params = [sessionId, project, owner ?? null];

  if (existingSummary && existingSummary.last_processed_seq_id) {
    query += " AND sequence_id > $4";
    params.push(existingSummary.last_processed_seq_id);
  }

  query += " ORDER BY sequence_id ASC";

  const newMessages = await db.allAsync(query, params);

  if (newMessages.length === 0 && existingSummary) {
    console.log("No hay mensajes nuevos para resumir.");
    return {
      summary: existingSummary.summary,
      summaryGenerated: true,
      auditRequired: false,
      summaryPending: false,
    };
  }

  // 3. Generar resumen incremental.
  const summary = await generateSessionSummary({
    sessionId,
    previousSummary: existingSummary ? existingSummary.summary : null,
    newMessages,
  });

  // Sin LLM (o ante un error del proveedor), no se crea un resumen artificial
  // ni se marca el delta como procesado. El historial sigue persistido y podrá
  // resumirse cuando vuelva a estar disponible un LLM.
  if (!summary) {
    console.log("No se generó resumen: LLM no disponible.");
    return {
      summary: existingSummary?.summary ?? null,
      summaryGenerated: false,
      auditRequired: false,
      summaryPending: true,
      reason: "llm_unavailable",
    };
  }

  // 4. Guardar nuevo resumen y actualizar el ID del último mensaje.
  const lastMessageSeqId = newMessages[newMessages.length - 1].sequence_id;

  await saveSessionSummary({
    sessionId,
    project,
    owner,
    summary,
    lastProcessedSeqId: lastMessageSeqId,
  });

  return {
    summary,
    summaryGenerated: true,
    auditRequired: true,
    summaryPending: false,
  };
}

module.exports = finalizeSession;
