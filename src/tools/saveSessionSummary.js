const { withAdvisoryLock } = require("../database");
const { generateEmbedding, isEmbeddingsEnabled } = require("../services/embeddingService");
const { resolveWriteOwner } = require("../context");

/**
 * Guarda o actualiza el resumen de una sesión específica y su embedding.
 *
 * El embedding se genera antes de tocar session_summaries y antes de tomar el
 * lock: es la parte lenta y, si falla, el watermark no debe quedar avanzado
 * (los mensajes quedarían marcados como procesados sin resumen que los cubra y
 * nunca se reintentarían). El resumen y su embedding se escriben juntos en una
 * sola transacción, con una guarda por watermark también en el UPSERT del
 * embedding, para que dos llamadas concurrentes no dejen el vector de un
 * resumen viejo pegado al resumen nuevo.
 */
async function saveSessionSummary({ sessionId, project, summary, lastProcessedSeqId, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  try {
    const writeOwner = resolveWriteOwner(owner);

    const embedding = isEmbeddingsEnabled()
      ? await generateEmbedding({ role: "session_summary", content: summary })
      : null;

    return await withAdvisoryLock(`save-summary-session:${writeOwner}:${sessionId}`, async (client) => {
      const existingSession = await client.query(
        `SELECT project FROM conversations WHERE session_id = $1 AND owner = $2 LIMIT 1`,
        [sessionId, writeOwner]
      );
      const existing = existingSession.rows[0];

      if (existing?.project && existing.project !== project) {
        const error = new Error(
          "La sesión no está disponible para este proyecto y usuario."
        );
        error.code = "SESSION_UNAVAILABLE";
        throw error;
      }

      const summarySql = `
        INSERT INTO session_summaries (session_id, project, owner, summary, last_processed_seq_id, timestamp)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id, owner) DO UPDATE SET
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

      const summaryResult = await client.query(summarySql, [
        sessionId,
        project,
        writeOwner,
        summary,
        lastProcessedSeqId,
      ]);

      if (summaryResult.rowCount === 0) {
        return false;
      }

      // Solo se llega acá si el UPSERT de resumen ganó la guarda por watermark,
      // así que la fila de session_summaries es la que acaba de escribir esta
      // misma transacción: el embedding corresponde al resumen guardado.
      if (embedding) {
        await client.query(
          `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
           VALUES ($1, $2, $3)
           ON CONFLICT(session_id, owner) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [sessionId, writeOwner, embedding]
        );
      }

      return true;
    });
  } catch (err) {
    console.error("Error saving session summary and embedding:", err.message);
    throw err;
  }
}

module.exports = saveSessionSummary;