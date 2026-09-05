// Motor de decisión de auditoría de memorias.
// Puro y determinista (sin LLM, sin IO): la decisión por LLM es responsabilidad
// de src/tools/memoryAudit.js, que usa este motor como fallback o como
// comparación cuando el LLM no está disponible.

const ALLOWED_STATUSES = new Set([
  "missing",
  "already_exists",
  "related",
  "possible_duplicate",
  "conflict",
  "pending",
  "discard",
]);

// Umbrales de la heurística (score normalizado 0..1).
const THRESHOLDS = {
  already_exists: 0.7,
  possible_duplicate: 0.45,
  related: 0.25,
};

// Bonus modesto por coincidencia de tipo de memoria.
const TYPE_BONUS = 0.05;

/**
 * Normaliza el texto a un conjunto de tokens (minúsculas, sin acentos).
 * @param {string} text - Texto a tokenizar.
 * @returns {string[]} Tokens.
 */
function tokenize(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.match(/[a-z0-9]+/g) || [];
}

/**
 * Similitud de Jaccard entre dos conjuntos.
 * @param {Set} a
 * @param {Set} b
 * @returns {number} 0..1
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Similitud por contención: fracción de tokens compartidos sobre el conjunto menor.
 * @param {Set} a
 * @param {Set} b
 * @returns {number} 0..1
 */
function containment(a, b) {
  const minSize = Math.min(a.size, b.size);
  if (minSize === 0) return 0;
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) inter += 1;
  }
  return inter / minSize;
}

/**
 * Similitud entre dos textos: máximo entre Jaccard y contención.
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0..1
 */
function similarity(textA, textB) {
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  return Math.max(jaccard(setA, setB), containment(setA, setB));
}

/**
 * Texto representativo de un candidato para comparaciones.
 * @param {Object} candidate - Candidato de extractMemories.
 * @returns {string}
 */
function candidateText(candidate) {
  return [candidate.title, candidate.what, candidate.why, candidate.whereContext, candidate.learned]
    .filter(Boolean)
    .join(" ");
}

/**
 * Texto representativo de una memoria existente para comparaciones.
 * @param {Object} memory - Memoria normalizada del adaptador.
 * @returns {string}
 */
function memoryText(memory) {
  return [memory.title, memory.content].filter(Boolean).join(" ");
}

/**
 * Verifica que los sourceMessageIds de un candidato sean trazables a mensajes
 * reales de la sesión recuperada.
 * @param {Object} params
 * @param {Object} params.candidate - Candidato.
 * @param {Array} params.messages - Mensajes recuperados de Neon.
 * @returns {Object} { valid, reason, traceableIds }.
 */
function verifySourceMessages({ candidate, messages }) {
  const rawIds = Array.isArray(candidate.sourceMessageIds) ? candidate.sourceMessageIds : [];
  if (rawIds.length === 0) {
    return { valid: false, reason: "El candidato no tiene sourceMessageIds trazables a la conversación.", traceableIds: [] };
  }
  const existingIds = new Set(messages.map((m) => m.id));
  const traceableIds = rawIds
    .map((id) => String(id).replace(/^msg-/, ""))
    .filter((id) => existingIds.has(id));
  if (traceableIds.length === 0) {
    return { valid: false, reason: "Ningún sourceMessageId del candidato existe en la conversación.", traceableIds: [] };
  }
  return { valid: true, reason: "Campo traceable correctamente.", traceableIds };
}

/**
 * Decide el estado de un candidato por heurística pura.
 * NUNCA emite "conflict" (ese estado solo se decide con LLM).
 * @param {Object} candidate - Candidato de extractMemories.
 * @param {Array} [related] - Memorias existentes normalizadas del adaptador.
 * @returns {Object} { status, reason, relatedMemories }.
 */
function decideHeuristically(candidate, related = []) {
  const base = candidateText(candidate);
  const scored = related
    .map((memory) => ({ ...memory, score: similarity(base, memoryText(memory)) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      status: "missing",
      reason: "No se encontraron memorias relacionadas en el proveedor.",
      relatedMemories: [],
    };
  }

  const top = scored[0];
  let score = top.score;
  if (top.type && candidate.type && top.type === candidate.type) {
    score = Math.min(1, score + TYPE_BONUS);
  }

  let status;
  if (score >= THRESHOLDS.already_exists) {
    status = "already_exists";
  } else if (score >= THRESHOLDS.possible_duplicate) {
    status = "possible_duplicate";
  } else if (score >= THRESHOLDS.related) {
    status = "related";
  } else {
    status = "missing";
  }

  return {
    status,
    reason: `Memoria existente con mayor similitud "${top.title}" (score ${score.toFixed(2)}).`,
    relatedMemories: scored.map((m) => ({ id: m.id, topicKey: m.topicKey || null, score: m.score })),
  };
}

function isValidStatus(status) {
  return ALLOWED_STATUSES.has(status);
}

module.exports = {
  ALLOWED_STATUSES,
  THRESHOLDS,
  TYPE_BONUS,
  tokenize,
  similarity,
  candidateText,
  memoryText,
  verifySourceMessages,
  decideHeuristically,
  isValidStatus,
};