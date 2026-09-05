// memoryAudit: segunda etapa del pipeline de memoria inteligente.
// Toma los candidatos de extractMemories, los contrasta contra el proveedor de
// memoria dura (adaptador de solo lectura), decide su estado (LLM con fallback
// heurístico) y persiste el resultado en Neon (memory_candidates).
// NO promueve memorias a Engram: eso es responsabilidad de memoryPromote.
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { db } = require("../database");
const extractMemories = require("./extractMemories");
const memoryAdapterService = require("../services/memoryAdapter");
const {
  decideHeuristically,
  verifySourceMessages,
  isValidStatus,
} = require("../services/memoryAuditEngine");

// Estados que el LLM puede decidir directamente (nunca pending/discard).
const LLM_STATUSES = new Set(["missing", "already_exists", "related", "possible_duplicate", "conflict"]);

const AUDIT_MODEL = "gemini-2.5-flash-lite";
const SEARCH_LIMIT = 5;

/**
 * Calcula un id estable para un candidato, permitiendo re-auditar la misma
 * sesión sin duplicar filas (idempotencia).
 * @param {Object} params
 * @param {string} params.project
 * @param {string} params.sessionId
 * @param {Object} params.candidate
 * @returns {string} Hash sha256 truncado.
 */
function computeCandidateId({ project, sessionId, candidate }) {
  const key = [
    project,
    sessionId,
    String(candidate.type || "").toLowerCase(),
    String(candidate.title || "").toLowerCase().trim(),
  ].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Texto de búsqueda para contrastar un candidato contra el proveedor.
 * @param {Object} candidate
 * @returns {string}
 */
function candidateSearchQuery(candidate) {
  return [candidate.title, candidate.what, candidate.whereContext, candidate.learned]
    .filter(Boolean)
    .join(" ");
}

/**
 * Audita los candidatos de una sesión contra el proveedor de memoria.
 * @param {Object} params
 * @param {string} params.sessionId - ID de la sesión a auditar.
 * @param {string} params.project - Proyecto (obligatorio).
 * @param {string} [params.agentId] - Filtro de agente.
 * @returns {Promise<Object>} Resultado de la auditoría.
 */
async function memoryAudit({ sessionId, project, agentId }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  const extraction = await extractMemories({ sessionId, project, agentId });

  // Sesión inexistente: respuesta controlada, sin auditar ni consultar el proveedor.
  if (!extraction.sessionExists) {
    return {
      sessionId,
      project,
      agentId: agentId || null,
      sessionExists: false,
      messageCount: 0,
      memoryProvider: null,
      candidates: [],
    };
  }

  const adapter = memoryAdapterService.getMemoryAdapter();
  const providerStatus = await adapter.getStatus();
  const memoryProvider = {
    available: providerStatus.available,
    provider: adapter.provider,
    ...(providerStatus.version ? { version: providerStatus.version } : {}),
  };

  const candidates = [];
  for (const candidate of extraction.candidates) {
    const audited = await auditCandidate({
      candidate,
      extraction,
      adapter,
      providerStatus,
      project,
      sessionId,
      agentId,
    });
    candidates.push(audited);
  }

  return {
    sessionId,
    project,
    agentId: agentId || null,
    sessionExists: true,
    messageCount: extraction.messageCount,
    memoryProvider,
    candidates,
  };
}

/**
 * Audita un candidato individual: trazabilidad, contraste y persistencia.
 * @param {Object} params
 * @returns {Promise<Object>} Decisión { candidateId, status, reason, relatedMemories, promotable }.
 */
async function auditCandidate({ candidate, extraction, adapter, providerStatus, project, sessionId, agentId }) {
  const candidateId = computeCandidateId({ project, sessionId, candidate });

  const origin = verifySourceMessages({ candidate, messages: extraction.messages });
  if (!origin.valid) {
    return finishCandidate(candidate, {
      candidateId,
      status: "discard",
      reason: origin.reason,
      relatedMemories: [],
    }, { project, sessionId, agentId, sourceMessageIds: [] });
  }

  // Proveedor no disponible: no se puede contrastar, queda pendiente.
  if (!providerStatus.available) {
    const why = providerStatus.error ? providerStatus.error : "proveedor no disponible";
    return finishCandidate(candidate, {
      candidateId,
      status: "pending",
      reason: `No se pudo contrastar contra ${adapter.provider}: ${why}`,
      relatedMemories: [],
    }, { project, sessionId, agentId, sourceMessageIds: origin.traceableIds });
  }

  let related;
  try {
    related = await adapter.searchRelated({
      query: candidateSearchQuery(candidate),
      project,
      limit: SEARCH_LIMIT,
    });
  } catch (err) {
    return finishCandidate(candidate, {
      candidateId,
      status: "pending",
      reason: `No se pudo consultar ${adapter.provider}: ${err.message}`,
      relatedMemories: [],
    }, { project, sessionId, agentId, sourceMessageIds: origin.traceableIds });
  }

  const decision = await decideCandidate({ candidate, related, project });
  return finishCandidate(candidate, {
    candidateId,
    status: decision.status,
    reason: decision.reason,
    relatedMemories: decision.relatedMemories,
  }, { project, sessionId, agentId, sourceMessageIds: origin.traceableIds });
}

/**
 * Decide el estado de un candidato: LLM si hay API key en el momento de la
 * llamada (testeable), si no, heurística determinista. El paso LLM no es
 * obligatorio: sin API key la auditoría sigue funcionando con la heurística.
 * @param {Object} params
 * @returns {Promise<Object>} Decisión { status, reason, relatedMemories }.
 */
async function decideCandidate({ candidate, related, project }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      return await llmVerdict({ candidate, related, project, apiKey });
    } catch (err) {
      console.error("Error en la decisión LLM de auditoría:", err.message);
    }
  }
  return heuristicVerdict(candidate, related);
}

/**
 * Veredicto por heurística pura (fallback determinista).
 * @param {Object} candidate
 * @param {Array} related
 * @returns {Object}
 */
function heuristicVerdict(candidate, related) {
  const decision = decideHeuristically(candidate, related);
  return {
    status: isValidStatus(decision.status) ? decision.status : "missing",
    reason: decision.reason,
    relatedMemories: decision.relatedMemories.map(({ id, topicKey }) => ({ id, topicKey })),
  };
}

/**
 * Veredicto por LLM. Se degrada a heurística si el LLM no devuelve un estado
 * válido (evita que una respuesta corrupta rompa la auditoría).
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function llmVerdict({ candidate, related, project, apiKey }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: AUDIT_MODEL });

  const relatedText = related.length > 0
    ? related.map((m) => `- [${m.id}] (${m.type || "unknown"}) "${m.title}"\n  ${m.content || ""}`).join("\n")
    : "No hay memorias existentes relacionadas.";

  const prompt = `
    Eres un experto en auditoría de memoria semántica de conversaciones.
    Tu tarea es decidir QUÉ HACER con UN candidato de memoria durable comparándolo con las memorias ya existentes.

    MEMORIAS EXISTENTES:
    ${relatedText}

    ESTADOS POSIBLES (elegí exactamente UNO):
    - missing: no existe nada equivalente; el candidato es candidato a ser promovido como memoria nueva.
    - already_exists: una memoria existente ya cubre el mismo conocimiento; no hay nada que hacer.
    - related: existe una memoria relacionada pero distinta; el candidato complementa.
    - possible_duplicate: probablemente es un duplicado de una memoria existente; requiere revisión.
    - conflict: el candidato contradice una memoria existente.

    ESTRUCTURA REQUERIDA (JSON AUDIT):
    {
      "status": "missing | already_exists | related | possible_duplicate | conflict",
      "reason": "string corto explicando la decisión",
      "relatedMemoryIds": ["<id de memoria existente>", ...]
    }

    En "relatedMemoryIds" incluí SOLO ids de la lista MEMORIAS EXISTENTES que respalden tu decisión (puede ser vacío).
    NO incluyas introducciones ni textos fuera del JSON.

    CANDIDATO:
    ${JSON.stringify(candidate, null, 2)}
  `;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(jsonString);

  if (!parsed || !LLM_STATUSES.has(parsed.status)) {
    return heuristicVerdict(candidate, related);
  }

  const referenced = new Set(Array.isArray(parsed.relatedMemoryIds) ? parsed.relatedMemoryIds : []);
  return {
    status: parsed.status,
    reason: parsed.reason ? String(parsed.reason).trim() : `Veredicto: ${parsed.status}`,
    relatedMemories: related
      .filter((memory) => referenced.has(memory.id))
      .map((memory) => ({ id: memory.id, topicKey: memory.topicKey || null })),
  };
}

/**
 * Persiste el resultado en Neon (upsert idempotente por candidateId) y devuelve
 * la decisión final agregando "promotable".
 * @param {Object} candidate - Candidato original.
 * @param {Object} decision - { candidateId, status, reason, relatedMemories }.
 * @param {Object} meta - { project, sessionId, agentId, sourceMessageIds }.
 * @returns {Promise<Object>} Decisión final.
 */
async function finishCandidate(candidate, decision, { project, sessionId, agentId, sourceMessageIds }) {
  await persistCandidate(candidate, decision, { project, sessionId, agentId, sourceMessageIds });
  return { ...decision, promotable: decision.status === "missing" };
}

/**
 * Upsert en memory_candidates. En el conflicto nunca toca engram_id,
 * engram_topic_key, promoted_at ni created_at: esas columnas pertenecen a la
 * etapa de promoción y no deben ser reiniciadas por una re-auditoría.
 * @param {Object} args
 */
async function persistCandidate(candidate, decision, { project, sessionId, agentId, sourceMessageIds }) {
  const sql = `
    INSERT INTO memory_candidates (
      id, project, session_id, agent_id, type, title, topic_key, what, why,
      where_context, learned, importance, status, source_message_ids,
      engram_id, engram_topic_key, audited_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (id) DO UPDATE SET
      project = EXCLUDED.project,
      session_id = EXCLUDED.session_id,
      agent_id = EXCLUDED.agent_id,
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      topic_key = EXCLUDED.topic_key,
      what = EXCLUDED.what,
      why = EXCLUDED.why,
      where_context = EXCLUDED.where_context,
      learned = EXCLUDED.learned,
      importance = EXCLUDED.importance,
      status = EXCLUDED.status,
      source_message_ids = EXCLUDED.source_message_ids,
      audited_at = EXCLUDED.audited_at
  `;
  await db.runAsync(sql, [
    decision.candidateId,
    project,
    sessionId,
    agentId || null,
    candidate.type,
    candidate.title,
    null, // topic_key: se completa en la promoción
    candidate.what || null,
    candidate.why || null,
    candidate.whereContext || null,
    candidate.learned || null,
    candidate.importance || null,
    decision.status,
    JSON.stringify(sourceMessageIds || []),
    null, // engram_id: se completa en la promoción
    null, // engram_topic_key: se completa en la promoción
    new Date().toISOString(),
  ]);
}

module.exports = memoryAudit;
module.exports.memoryAudit = memoryAudit;
module.exports.computeCandidateId = computeCandidateId;
module.exports.candidateSearchQuery = candidateSearchQuery;