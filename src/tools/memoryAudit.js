// memoryAudit: segunda etapa del pipeline de memoria inteligente.
// Toma los candidatos de extractMemories, los contrasta contra el proveedor de
// memoria dura (adaptador de solo lectura), decide su estado (LLM con fallback
// heurístico) y persiste el resultado en Neon (memory_candidates).
// NO promueve memorias a Engram: eso es responsabilidad de memoryPromote.
const crypto = require("crypto");
const { db } = require("../database");
const { resolveWriteOwner } = require("../context");
const extractMemories = require("./extractMemories");
const { generateText } = require("../services/llmClient");
const memoryAdapterService = require("../services/memoryAdapter");
const {
  decideHeuristically,
  verifySourceMessages,
  isValidStatus,
} = require("../services/memoryAuditEngine");

const LLM_STATUSES = new Set(["missing", "already_exists", "related", "possible_duplicate", "conflict"]);
const SEARCH_LIMIT = 5;

/**
 * Calcula un id estable para un candidato, permitiendo re-auditar la misma
 * sesión sin duplicar filas. El owner forma parte de la identidad para evitar
 * colisiones entre tenants que compartan project/sessionId.
 */
function computeCandidateId({ project, sessionId, candidate, owner }) {
  const writeOwner = resolveWriteOwner(owner);
  const key = [
    project,
    writeOwner,
    sessionId,
    String(candidate.type || "").toLowerCase(),
    String(candidate.title || "").toLowerCase().trim(),
  ].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function candidateSearchQuery(candidate) {
  return [candidate.title, candidate.what, candidate.whereContext, candidate.learned]
    .filter(Boolean)
    .join(" ");
}

async function memoryAudit({ sessionId, project, agentId, owner }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  const extraction = await extractMemories({ sessionId, project, agentId, owner });

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
      owner,
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

async function auditCandidate({ candidate, extraction, adapter, providerStatus, project, sessionId, agentId, owner }) {
  const candidateId = computeCandidateId({ project, sessionId, candidate, owner });

  const origin = verifySourceMessages({ candidate, messages: extraction.messages });
  if (!origin.valid) {
    return finishCandidate(candidate, {
      candidateId,
      status: "discard",
      reason: origin.reason,
      relatedMemories: [],
    }, { project, sessionId, agentId, owner, sourceMessageIds: [] });
  }

  if (!providerStatus.available) {
    const why = providerStatus.error ? providerStatus.error : "proveedor no disponible";
    return finishCandidate(candidate, {
      candidateId,
      status: "pending",
      reason: `No se pudo contrastar contra ${adapter.provider}: ${why}`,
      relatedMemories: [],
    }, { project, sessionId, agentId, owner, sourceMessageIds: origin.traceableIds });
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
    }, { project, sessionId, agentId, owner, sourceMessageIds: origin.traceableIds });
  }

  const decision = await decideCandidate({ candidate, related, project });
  return finishCandidate(candidate, {
    candidateId,
    status: decision.status,
    reason: decision.reason,
    relatedMemories: decision.relatedMemories,
  }, { project, sessionId, agentId, owner, sourceMessageIds: origin.traceableIds });
}

async function decideCandidate({ candidate, related, project }) {
  try {
    return await llmVerdict({ candidate, related });
  } catch (err) {
    console.error("Error en la decisión LLM de auditoría:", err.message);
  }
  return heuristicVerdict(candidate, related);
}

function heuristicVerdict(candidate, related) {
  const decision = decideHeuristically(candidate, related);
  return {
    status: isValidStatus(decision.status) ? decision.status : "missing",
    reason: decision.reason,
    relatedMemories: decision.relatedMemories.map(({ id, topicKey }) => ({ id, topicKey })),
  };
}

async function llmVerdict({ candidate, related }) {
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

  const text = await generateText(prompt);
  if (!text) return heuristicVerdict(candidate, related);
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

async function finishCandidate(candidate, decision, { project, sessionId, agentId, owner, sourceMessageIds }) {
  await persistCandidate(candidate, decision, { project, sessionId, agentId, owner, sourceMessageIds });
  return { ...decision, promotable: decision.status === "missing" };
}

async function persistCandidate(candidate, decision, { project, sessionId, agentId, owner, sourceMessageIds }) {
  const sql = `
    INSERT INTO memory_candidates (
      id, project, owner, session_id, agent_id, type, title, topic_key, what, why,
      where_context, learned, importance, status, source_message_ids,
      engram_id, engram_topic_key, audited_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (id) DO UPDATE SET
      project = EXCLUDED.project,
      owner = EXCLUDED.owner,
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
    WHERE memory_candidates.owner = EXCLUDED.owner
  `;
  await db.runAsync(sql, [
    decision.candidateId,
    project,
    resolveWriteOwner(owner),
    sessionId,
    agentId || null,
    candidate.type,
    candidate.title,
    null,
    candidate.what || null,
    candidate.why || null,
    candidate.whereContext || null,
    candidate.learned || null,
    candidate.importance || null,
    decision.status,
    JSON.stringify(sourceMessageIds || []),
    null,
    null,
    new Date().toISOString(),
  ]);
}

module.exports = memoryAudit;
module.exports.memoryAudit = memoryAudit;
module.exports.computeCandidateId = computeCandidateId;
module.exports.candidateSearchQuery = candidateSearchQuery;
