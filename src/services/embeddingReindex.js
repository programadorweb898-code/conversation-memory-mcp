const { db } = require("../database");
const embeddingService = require("./embeddingService");
const { getConfig } = require("../config");

const DEFAULT_SCOPE = "all";
const SCOPES = new Set(["all", "messages", "summaries"]);

function normalizeBatchSize(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("batchSize debe ser un entero positivo.");
  }
  return parsed;
}

function normalizeScope(scope) {
  const normalized = scope || DEFAULT_SCOPE;
  if (!SCOPES.has(normalized)) {
    throw new Error(`scope inválido: "${normalized}". Usá all, messages o summaries.`);
  }
  return normalized;
}

function createEmbeddingReindexer({
  dbClient = db,
  embeddingServiceClient = embeddingService,
  configClient = getConfig(),
  logger = console,
} = {}) {
  const defaultBatchSize = configClient.embeddings.batchSize;
  const minEmbeddingChars = configClient.embeddings.minChars;
  const maxEmbeddingChars = configClient.embeddings.maxChars;

  function prepareContent(content) {
    const text = typeof content === "string" ? content.trim() : "";
    if (text.length < minEmbeddingChars) return null;
    return text.slice(0, maxEmbeddingChars);
  }

  async function reindexMessages({
    owner = null,
    batchSize = defaultBatchSize,
    dryRun = false,
  } = {}) {
    const effectiveBatchSize = normalizeBatchSize(batchSize, defaultBatchSize);
    const stats = {
      scanned: 0,
      reindexed: 0,
      skipped: 0,
      batches: 0,
    };

    let afterSequenceId = null;

    while (true) {
      const params = [];
      const where = [];

      if (afterSequenceId !== null) {
        params.push(String(afterSequenceId));
        where.push(`c.sequence_id > $${params.length}::bigint`);
      }

      if (owner) {
        params.push(owner);
        where.push(`c.owner = $${params.length}`);
      }

      params.push(effectiveBatchSize);
      const limitPlaceholder = `$${params.length}`;

      const rows = await dbClient.allAsync(
        `
          SELECT c.id, c.sequence_id, c.role, c.content
          FROM conversations c
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY c.sequence_id ASC
          LIMIT ${limitPlaceholder}
        `,
        params,
      );

      if (rows.length === 0) break;

      stats.batches += 1;
      stats.scanned += rows.length;

      const embeddable = [];
      const skippedIds = [];

      for (const row of rows) {
        const content = prepareContent(row.content);
        if (content === null) {
          skippedIds.push(row.id);
          stats.skipped += 1;
          continue;
        }

        embeddable.push({
          id: row.id,
          role: row.role,
          content,
        });
      }

      if (!dryRun && embeddable.length > 0) {
        const embeddings = await embeddingServiceClient.generateEmbeddings(
          embeddable.map(({ role, content }) => ({ role, content })),
        );

        if (embeddings.length !== embeddable.length) {
          throw new Error(
            `Cantidad de embeddings inválida: el generador devolvió ${embeddings.length} embeddings para ${embeddable.length} mensajes.`,
          );
        }

        for (let index = 0; index < embeddable.length; index += 1) {
          const message = embeddable[index];
          await embeddingServiceClient.saveEmbedding(message.id, embeddings[index]);
          await dbClient.runAsync(
            "DELETE FROM embedding_failures WHERE message_id = $1",
            [message.id],
          );
          stats.reindexed += 1;
        }
      }

      if (!dryRun && skippedIds.length > 0) {
        await dbClient.runAsync(
          `DELETE FROM message_embeddings me
           USING conversations c
           WHERE me.message_id = c.id
             AND me.message_id = ANY($1::text[])
             AND length(btrim(c.content)) < $2`,
          [skippedIds, minEmbeddingChars],
        );
      }

      if (dryRun) {
        stats.reindexed += embeddable.length;
      }

      afterSequenceId = rows[rows.length - 1].sequence_id;
      logger.log(
        `Reindex mensajes: lote ${stats.batches}, escaneados=${stats.scanned}, reindexados=${stats.reindexed}, omitidos=${stats.skipped}.`,
      );
    }

    return stats;
  }

  async function reindexSummaries({
    owner = null,
    batchSize = defaultBatchSize,
    dryRun = false,
  } = {}) {
    const effectiveBatchSize = normalizeBatchSize(batchSize, defaultBatchSize);
    const stats = {
      scanned: 0,
      reindexed: 0,
      batches: 0,
    };

    let cursor = null;

    while (true) {
      const params = [];
      const where = [];

      if (cursor) {
        params.push(cursor.timestamp, cursor.sessionId, cursor.owner);
        where.push(
          `(COALESCE(ss.timestamp, TIMESTAMP '1970-01-01 00:00:00'), ss.session_id, ss.owner) > ($${params.length}::timestamp, $${params.length + 1}, $${params.length + 2})`,
        );
      }

      if (owner) {
        params.push(owner);
        where.push(`ss.owner = $${params.length}`);
      }

      params.push(effectiveBatchSize);
      const limitPlaceholder = `$${params.length}`;

      const rows = await dbClient.allAsync(
        `
          SELECT
            ss.session_id,
            ss.owner,
            ss.summary,
            COALESCE(ss.timestamp, TIMESTAMP '1970-01-01 00:00:00')::text AS cursor_timestamp
          FROM session_summaries ss
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY
            COALESCE(ss.timestamp, TIMESTAMP '1970-01-01 00:00:00') ASC,
            ss.session_id ASC,
            ss.owner ASC
          LIMIT ${limitPlaceholder}
        `,
        params,
      );

      if (rows.length === 0) break;

      stats.batches += 1;
      stats.scanned += rows.length;

      if (!dryRun) {
        const embeddings = await embeddingServiceClient.generateEmbeddings(
          rows.map((row) => ({
            role: "session_summary",
            content: row.summary,
          })),
        );

        if (embeddings.length !== rows.length) {
          throw new Error(
            `Cantidad de embeddings inválida: el generador devolvió ${embeddings.length} embeddings para ${rows.length} resúmenes.`,
          );
        }

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          await dbClient.runAsync(
            `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
             VALUES ($1, $2, $3)
             ON CONFLICT(session_id, owner) DO UPDATE SET embedding = EXCLUDED.embedding`,
            [row.session_id, row.owner, embeddings[index]],
          );
          stats.reindexed += 1;
        }
      } else {
        stats.reindexed += rows.length;
      }

      const last = rows[rows.length - 1];
      cursor = {
        timestamp: last.cursor_timestamp,
        sessionId: last.session_id,
        owner: last.owner,
      };

      logger.log(
        `Reindex resúmenes: lote ${stats.batches}, escaneados=${stats.scanned}, reindexados=${stats.reindexed}.`,
      );
    }

    return stats;
  }

  async function reindexEmbeddings({
    owner = null,
    batchSize = defaultBatchSize,
    scope = DEFAULT_SCOPE,
    dryRun = false,
  } = {}) {
    const normalizedScope = normalizeScope(scope);
    const effectiveBatchSize = normalizeBatchSize(batchSize, defaultBatchSize);

    const result = {
      scope: normalizedScope,
      owner,
      batchSize: effectiveBatchSize,
      dryRun: Boolean(dryRun),
      messages: null,
      summaries: null,
    };

    if (normalizedScope === "all" || normalizedScope === "messages") {
      result.messages = await reindexMessages({
        owner,
        batchSize: effectiveBatchSize,
        dryRun,
      });
    }

    if (normalizedScope === "all" || normalizedScope === "summaries") {
      result.summaries = await reindexSummaries({
        owner,
        batchSize: effectiveBatchSize,
        dryRun,
      });
    }

    return result;
  }

  return {
    reindexEmbeddings,
    reindexMessages,
    reindexSummaries,
    normalizeBatchSize: (value) => normalizeBatchSize(value, defaultBatchSize),
    normalizeScope,
  };
}

module.exports = {
  createEmbeddingReindexer,
  normalizeBatchSize,
  normalizeScope,
  DEFAULT_SCOPE,
  SCOPES,
};
