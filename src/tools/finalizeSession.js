const generateSessionSummary = require("./generateSessionSummary");
const saveSessionSummary = require("./saveSessionSummary");
const { db } = require("../database");
const { resolveWriteOwner } = require("../context");

async function finalizeSession({ sessionId, project, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  console.log(`Finalizando sesión: ${sessionId}`);
  const writeOwner = resolveWriteOwner(owner);

  const existingSession = await db.getAsync(
    "SELECT project FROM conversations WHERE session_id = $1 AND owner = $2 LIMIT 1",
    [sessionId, writeOwner]
  );

  if (existingSession?.project && existingSession.project !== project) {
    const error = new Error("La sesión no está disponible para este proyecto y usuario.");
    error.code = "SESSION_UNAVAILABLE";
    throw error;
  }

  const existingSummary = await db.getAsync(
    "SELECT summary, last_processed_seq_id FROM session_summaries WHERE session_id = $1 AND project = $2 AND owner = $3",
    [sessionId, project, writeOwner]
  );

  let query = `
    SELECT id, sequence_id, role, content, timestamp
    FROM conversations
    WHERE session_id = $1 AND project = $2 AND owner = $3
  `;
  const params = [sessionId, project, writeOwner];

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
      summaryPending: false,
    };
  }

  const summary = await generateSessionSummary({
    sessionId,
    previousSummary: existingSummary ? existingSummary.summary : null,
    newMessages,
  });

  if (!summary) {
    console.log("No se generó resumen: LLM no disponible.");
    return {
      summary: existingSummary?.summary ?? null,
      summaryGenerated: false,
      summaryPending: true,
      reason: "llm_unavailable",
    };
  }

  const lastMessageSeqId = newMessages[newMessages.length - 1].sequence_id;

  const saved = await saveSessionSummary({
    sessionId,
    project,
    owner: writeOwner,
    summary,
    lastProcessedSeqId: lastMessageSeqId,
  });

  if (!saved) {
    const latest = await db.getAsync(
      "SELECT summary FROM session_summaries WHERE session_id = $1 AND project = $2 AND owner = $3",
      [sessionId, project, writeOwner]
    );

    return {
      summary: latest?.summary ?? summary,
      summaryGenerated: true,
      summaryPending: false,
      staleWriteSkipped: true,
    };
  }

  return {
    summary,
    summaryGenerated: true,
    summaryPending: false,
  };
}

module.exports = finalizeSession;
