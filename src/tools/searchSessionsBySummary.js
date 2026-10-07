const { db } = require("../database");
const logger = require("../logger");
const embeddingService = require("../services/embeddingService");

function tokenizeQuery(query) {
  return [...new Set(
    String(query)
      .toLowerCase()
      .split(/\W+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  )];
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function searchSummaryLexically({ query, project, owner }) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const params = [project, owner ?? null];
  const likeClauses = [];
  const scoreClauses = [];

  for (const token of tokens) {
    params.push("%" + escapeLikePattern(token) + "%");
    const placeholder = "$" + params.length;
    likeClauses.push("summary ILIKE " + placeholder + " ESCAPE '\\'");
    scoreClauses.push("(summary ILIKE " + placeholder + " ESCAPE '\\')::int");
  }

  const limitPlaceholder = "$" + (params.length + 1);
  params.push(1);

  const sql = [
    "SELECT session_id, (" + scoreClauses.join(" + ") + ")::int AS lexical_score",
    "FROM session_summaries",
    "WHERE project = $1",
    "  AND ($2::text IS NULL OR owner = $2)",
    "  AND (" + likeClauses.join(" OR ") + ")",
    "ORDER BY lexical_score DESC, timestamp DESC, session_id ASC",
    "LIMIT " + limitPlaceholder,
  ].join("\n");

  return db.allAsync(sql, params);
}

/**
 * Busca sesiones relevantes basándose en un resumen semántico y recupera su historial.
 * La búsqueda semántica es la vía principal; si no puede ejecutarse o no encuentra
 * ninguna sesión elegible, se degrada a una búsqueda léxica por términos relevantes.
 *
 * @param {Object} params
 * @param {string} params.query - La pregunta del usuario.
 * @returns {Promise<Array>} El historial de la sesión encontrada.
 */
async function searchSessionsBySummary({
  query,
  project,
  owner,
  limit,
  afterSequenceId,
}) {
  if (!query) throw new Error("La consulta no puede estar vacía.");
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  const requestedLimit = Number.isInteger(limit) && limit > 0
    ? limit
    : require("../config").config.recoverSessionLimit;
  const maxLimit = require("../config").config.recoverSessionLimit;
  const effectiveLimit = Math.min(requestedLimit, maxLimit);

  if (
    afterSequenceId !== undefined &&
    afterSequenceId !== null &&
    !/^\d+$/.test(String(afterSequenceId))
  ) {
    throw new Error("El parámetro 'afterSequenceId' debe ser un sequence_id entero no negativo.");
  }

  const results = [];

  if (embeddingService.isEmbeddingsEnabled()) {
    try {
      const queryEmbeddingJson = await embeddingService.generateEmbedding({
        role: "search",
        content: query,
      });

      const sql = `
        SELECT
          sse.session_id,
          (1 - (sse.embedding <=> $1::vector)) AS similarity
        FROM session_summary_embeddings AS sse
        JOIN session_summaries AS ss
          ON ss.session_id = sse.session_id
         AND ss.owner = sse.owner
        WHERE ss.project = $2 AND ($3::text IS NULL OR ss.owner = $3)
        ORDER BY sse.embedding <=> $1::vector ASC
        LIMIT 1
      `;

      results.push(...await db.allAsync(sql, [queryEmbeddingJson, project, owner ?? null]));
    } catch (err) {
      // Los embeddings son una optimización. Una falla al generar el embedding
      // o al consultar pgvector no debe dejar la recuperación sin respuesta.
      logger.error(
        "Búsqueda semántica de resúmenes fallida, se usa el fallback textual:",
        err.message,
      );
    }
  }

  if (results.length === 0) {
    const lexicalResults = await searchSummaryLexically({ query, project, owner });

    if (lexicalResults.length === 0) {
      return [];
    }

    results.push({
      session_id: lexicalResults[0].session_id,
      similarity: null,
    });
  }

  const bestSessionId = results[0].session_id;
  logger.log(
    "Sesión encontrada mediante resumen: " + bestSessionId +
      (results[0].similarity === null
        ? " (coincidencia textual)"
        : " (Similitud: " + results[0].similarity + ")"),
  );

  const historyParams = [bestSessionId, project, owner ?? null];
  const historyWhere = [
    "session_id = $1",
    "project = $2",
    "($3::text IS NULL OR owner = $3)",
  ];

  if (afterSequenceId !== undefined && afterSequenceId !== null) {
    historyWhere.push("sequence_id > $4::bigint");
    historyParams.push(String(afterSequenceId));
  }

  const limitPlaceholder = "$" + (historyParams.length + 1);
  historyParams.push(effectiveLimit + 1);

  const historySql = `
    SELECT id, session_id, sequence_id, timestamp, project, role, content, agent_id
    FROM conversations
    WHERE ${historyWhere.join(" AND ")}
    ORDER BY sequence_id ASC
    LIMIT ${limitPlaceholder}
  `;

  const rows = await db.allAsync(historySql, historyParams);
  const hasMore = rows.length > effectiveLimit;
  const history = hasMore ? rows.slice(0, effectiveLimit) : rows;
  const nextAfterSequenceId = hasMore
    ? String(history[history.length - 1].sequence_id)
    : null;

  return { history, hasMore, nextAfterSequenceId };
}

module.exports = searchSessionsBySummary;
module.exports.tokenizeQuery = tokenizeQuery;
module.exports.searchSummaryLexically = searchSummaryLexically;