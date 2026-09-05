// memoryPromote: tercera etapa del pipeline de memoria.
// Toma candidatos auditados como promocionables (status="missing" y no
// promovidos) y los persiste a través de MemoryAdapter. No extrae, no audita y
// no contiene lógica específica de Engram: toda la traducción al proveedor le
// corresponde al adaptador.
const memoryAdapterService = require("../services/memoryAdapter");
const { db } = require("../database");

/**
 * Promueve candidatos de memoria auditados mediante el adaptador activo.
 * @param {Object} params
 * @param {string} params.sessionId - Sesión de conversación de origen.
 * @param {string} params.project - Proyecto (obligatorio).
 * @param {string} [params.agentId] - Agente que originó la conversación.
 * @param {string[]} [params.candidateIds] - Candidatos específicos a promover; si se omite, todos los promocionables de la sesión/proyecto.
 * @returns {Promise<Object>} Resultado global con un resultado por candidato.
 */
async function memoryPromote({ sessionId, project, agentId, candidateIds }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");
  if (!sessionId) throw new Error("El parámetro 'sessionId' es obligatorio.");

  const rows = await loadCandidates({ sessionId, project, candidateIds });
  const requested = candidateIds && candidateIds.length > 0
    ? [...new Set(candidateIds)]
    : rows.map((row) => row.id);

  // Clasifica cada candidato pedido sin tocar nada todavía. La decisión de la
  // auditoría (status) no se modifica: la promoción se representa únicamente
  // mediante promoted_at / engram_id / engram_topic_key.
  const plan = requested.map((id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      return {
        result: { candidateId: id, status: "not_found", reason: "No existe un candidato auditado con ese id en esta sesión/proyecto." },
      };
    }
    if (row.promoted_at || row.engram_id) {
      return { result: { candidateId: id, status: "already_promoted", memoryId: row.engram_id } };
    }
    if (row.status !== "missing") {
      return { result: { candidateId: id, status: "skipped", reason: `No es promocionable: la auditoría determinó status "${row.status}".` } };
    }
    return { type: "promote", row };
  });

  const adapter = memoryAdapterService.getMemoryAdapter();
  const providerStatus = await adapter.getStatus();
  const memoryProvider = {
    available: providerStatus.available,
    provider: adapter.provider,
    ...(providerStatus.version ? { version: providerStatus.version } : {}),
  };

  // Proveedor no disponible: no se promueve nada y no se tocan los candidatos.
  // El reintento posterior queda intacto (promoted_at/engram_id siguen NULL).
  if (!providerStatus.available) {
    for (const item of plan) {
      if (item.type === "promote") {
        item.result = {
          candidateId: item.row.id,
          status: "failed",
          reason: `Memory provider unavailable: ${providerStatus.error || "proveedor no disponible"}`,
        };
      }
    }
  } else {
    for (const item of plan) {
      if (item.type === "promote") item.result = await promoteCandidate(item.row, adapter);
    }
  }

  return {
    sessionId,
    project,
    agentId: agentId || null,
    memoryProvider,
    results: plan.map((item) => item.result),
  };
}

/**
 * Carga los candidatos de la sesión/proyecto. Si candidateIds se indica, filtra
 * por esos ids (devuelve solo los que existen).
 */
async function loadCandidates({ sessionId, project, candidateIds }) {
  if (candidateIds && candidateIds.length > 0) {
    const placeholders = candidateIds.map((_, i) => `$${i + 3}`).join(", ");
    const sql = `
      SELECT * FROM memory_candidates
      WHERE session_id = $1 AND project = $2 AND id IN (${placeholders})
    `;
    return db.allAsync(sql, [sessionId, project, ...candidateIds]);
  }
  const sql = `
    SELECT * FROM memory_candidates
    WHERE session_id = $1 AND project = $2
  `;
  return db.allAsync(sql, [sessionId, project]);
}

/**
 * Promueve un candidato individual. Re-chequea el flag de promoción justo antes
 * de llamar al adaptador (idempotencia frente a ejecuciones concurrentes).
 * @returns {Promise<Object>} Resultado { candidateId, status, memoryId|reason }.
 */
async function promoteCandidate(row, adapter) {
  const fresh = await getCandidateById(row.id);
  if (fresh && (fresh.promoted_at || fresh.engram_id)) {
    return { candidateId: row.id, status: "already_promoted", memoryId: fresh.engram_id };
  }

  const candidate = mapRowToCandidate(fresh || row);
  try {
    const promoted = await adapter.promote(candidate);
    const memoryId = promoted.id || null;
    try {
      await markPromoted({ candidateId: row.id, memoryId, topicKey: promoted.topicKey || null });
    } catch (err) {
      return {
        candidateId: row.id,
        status: "failed",
        reason: `La memoria fue creada pero no se pudo registrar la promoción localmente: ${err.message}`,
      };
    }
    return { candidateId: row.id, status: "promoted", memoryId };
  } catch (err) {
    // El candidato permanece sin promocionar: quedará disponible para un nuevo intento.
    return { candidateId: row.id, status: "failed", reason: err.message };
  }
}

/**
 * Marca la fila como promovida. Solo si todavía no lo estaba (idempotente).
 */
async function markPromoted({ candidateId, memoryId, topicKey }) {
  await db.runAsync(
    `UPDATE memory_candidates
     SET promoted_at = $1, engram_id = $2, engram_topic_key = $3
     WHERE id = $4 AND promoted_at IS NULL`,
    [new Date().toISOString(), memoryId, topicKey || null, candidateId]
  );
}

function getCandidateById(id) {
  return db.getAsync(`SELECT * FROM memory_candidates WHERE id = $1`, [id]);
}

/**
 * Traduce la fila de memory_candidates al candidato interno que espera el
 * adaptador (contracto MemoryAdapter.promote).
 */
function mapRowToCandidate(row) {
  return {
    project: row.project,
    sessionId: row.session_id,
    agentId: row.agent_id,
    type: row.type,
    title: row.title,
    topicKey: row.topic_key,
    what: row.what,
    why: row.why,
    whereContext: row.where_context,
    learned: row.learned,
    importance: row.importance,
    sourceMessageIds: Array.isArray(row.source_message_ids) ? row.source_message_ids : [],
  };
}

module.exports = memoryPromote;
module.exports.memoryPromote = memoryPromote;