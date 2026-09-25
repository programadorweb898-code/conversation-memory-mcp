const { db } = require("../database");
const { generateEmbedding } = require("../services/embeddingService");
const { resolveWriteOwner } = require("../context");

/**
 * Guarda o actualiza el resumen de una sesión específica y su embedding.
 */
async function saveSessionSummary({ sessionId, project, summary, lastProcessedSeqId, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  try {
    const writeOwner = resolveWriteOwner(owner);

    const existingSession = await db.getAsync(
      `SELECT project, owner FROM conversations WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );

    if (existingSession?.project && existingSession.project !== project) {
      const error = new Error(
        `La sesión ${sessionId} ya pertenece al proyecto "${existingSession.project}". No se permite mezclar datos entre proyectos.`
      );
      error.code = "PROJECT_CONFLICT";
      throw error;
    }

    if (existingSession?.owner && existingSession.owner !== writeOwner) {
      const error = new Error(`La sesión ${sessionId} ya existe y no pertenece a este usuario.`);
      error.code = "OWNER_CONFLICT";
      throw error;
    }

    const sql = `
      INSERT INTO session_summaries (session_id, project, owner, summary, last_processed_seq_id, timestamp)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        project = EXCLUDED.project,
        owner = EXCLUDED.owner,
        summary = EXCLUDED.summary,
        last_processed_seq_id = EXCLUDED.last_processed_seq_id,
        timestamp = EXCLUDED.timestamp
      WHERE session_summaries.owner IS NOT DISTINCT FROM EXCLUDED.owner
        AND (
          session_summaries.last_processed_seq_id IS NULL
          OR EXCLUDED.last_processed_seq_id > session_summaries.last_processed_seq_id
        )
      RETURNING session_id
    `;

    const result = await db.query(sql, [
      sessionId,
      project,
      writeOwner,
      summary,
      lastProcessedSeqId,
    ]);

    if (result.rowCount === 0) {
      return false;
    }

    const embedding = await generateEmbedding({
      role: "session_summary",
      content: summary,
    });

    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, embedding)
       VALUES ($1, $2)
       ON CONFLICT(session_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [sessionId, embedding]
    );

    return true;
  } catch (err) {
    console.error("Error saving session summary and embedding:", err.message);
    throw err;
  }
}

module.exports = saveSessionSummary;
