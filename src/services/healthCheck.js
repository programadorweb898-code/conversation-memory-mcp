// src/services/healthCheck.js
//
// Métricas agregadas del almacén. El objetivo es responder una sola pregunta:
// ¿la memoria conversacional está sirviendo lo que debería?
//
// Son agregados globales a propósito. /health es público (no exige token), así
// que no puede revelar nombres de proyecto ni de owner. El detalle por proyecto
// se consulta a mano contra la base cuando hace falta.

const { db } = require("../database");
const embeddingQueue = require("./embeddingQueue");
const { MIN_EMBEDDING_CHARS } = require("./embeddingService");

async function checkDatabase() {
  await db.query("SELECT 1");
}

async function getHealth() {
  const messages = await db.getAsync(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE agent_id IS NULL)::int AS sin_agent,
      max(timestamp) AS last_message_at
    FROM conversations
  `);

  // `skipped` son los mensajes demasiado cortos para embeber: no son un
  // backlog, se descartan por diseño y van a aparecer así para siempre. Contarlos
  // como "pending" hacía que /health mostrara trabajo pendiente que nunca avanza.
  const pending = await db.getAsync(`
    SELECT
      count(*) FILTER (
        WHERE m.message_id IS NULL AND length(btrim(c.content)) >= $1
      )::int AS total,
      count(*) FILTER (
        WHERE m.message_id IS NULL AND length(btrim(c.content)) < $1
      )::int AS skipped
    FROM conversations c
    LEFT JOIN message_embeddings m ON m.message_id = c.id
  `, [MIN_EMBEDDING_CHARS]);

  // Sin_generador no es un modo: si queda gente afuera del embedding, es backlog
  // real y el origen está en conversations, no en message_embeddings.
  const embeddingFailures = await db.getAsync(`
    SELECT
      count(*) FILTER (WHERE attempts > 0)::int AS with_failures,
      count(*) FILTER (WHERE attempts >= 3)::int AS sin_generador
    FROM embedding_failures
  `);

  const indexed = await db.getAsync(`
    SELECT count(*)::int AS total FROM message_embeddings
  `);

  const sessions = await db.getAsync(`
    SELECT
      count(DISTINCT (c.owner, c.session_id))::int AS total,
      count(DISTINCT (c.owner, c.session_id)) FILTER (WHERE ss.session_id IS NULL)::int AS sin_resumen
    FROM conversations c
    LEFT JOIN session_summaries ss ON ss.session_id = c.session_id AND ss.owner = c.owner
  `);

  const summaries = await db.getAsync(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE e.session_id IS NULL)::int AS sin_embedding
    FROM session_summaries ss
    LEFT JOIN session_summary_embeddings e ON e.session_id = ss.session_id AND e.owner = ss.owner
  `);

  const total = messages?.total ?? 0;
  const indexedCount = indexed?.total ?? 0;

  return {
    status: "ok",
    messages: {
      total,
      indexed: indexedCount,
      coveragePct: total > 0 ? Number(((indexedCount / total) * 100).toFixed(1)) : null,
      pending: pending?.total ?? 0,
      skipped: pending?.skipped ?? 0,
      sinAgentId: messages?.sin_agent ?? 0,
      lastMessageAt: messages?.last_message_at ?? null,
    },
    sessions: {
      total: sessions?.total ?? 0,
      withoutSummary: sessions?.sin_resumen ?? 0,
    },
    summaries: {
      total: summaries?.total ?? 0,
      withoutEmbedding: summaries?.sin_embedding ?? 0,
    },
    embeddingFailures: embeddingFailures?.with_failures ?? 0,
    embeddingsDescartados: embeddingFailures?.sin_generador ?? 0,
    embeddingQueueSize: embeddingQueue.size(),
  };
}

module.exports = { checkDatabase, getHealth };
