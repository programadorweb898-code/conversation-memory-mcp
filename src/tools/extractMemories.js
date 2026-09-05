const { GoogleGenerativeAI } = require("@google/generative-ai");
const recoverSession = require("./recoverSession");

const MEMORY_TYPES = ["decision", "discovery", "constraint", "configuration", "lesson"];

// Valores permitidos para la validación estricta de candidatos del LLM.
const VALID_TYPES = new Set(MEMORY_TYPES);

const VALID_IMPORTANCE = new Set([
  "low",
  "medium",
  "high",
]);

// Límites de longitud: evitan candidatos absurdamente grandes sin alterar el
// contenido válido que genera el LLM.
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_FIELD_LENGTH = 2000;

// Campos textuales opcionales: pueden faltar (o ser null/undefined), pero si
// están presentes deben ser strings razonables.
const OPTIONAL_TEXT_FIELDS = ["why", "whereContext", "learned"];

// El modelo es fijo, pero el cliente Gemini se resuelve dinámicamente en cada
// llamada (lee GEMINI_API_KEY en el momento), igual que memoryAudit. Así una
// key/configuración nueva se toma sin reiniciar el proceso.
const EXTRACT_MODEL = "gemini-2.5-flash-lite";

/**
 * Recupera una sesión completa, la analiza con un LLM y prepara una lista de
 * CANDIDATOS de memoria semántica durable. Es la primera etapa del pipeline:
 * NO guarda nada en Engram, NO decide la persistencia (eso es responsabilidad
 * de memoryAudit) ni modifica la conversación ni las memorias existentes.
 * Su única función es extraer posibles candidatos.
 * @param {Object} params - Parámetros de extracción.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @param {string} params.project - El proyecto al que pertenece la sesión.
 * @param {string} [params.agentId] - ID del agente para filtrar los mensajes.
 * @returns {Promise<Object>} - Sesión con los candidatos extraídos.
 */
async function extractMemories({ sessionId, project, agentId }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  const messages = await recoverSession({ sessionId, project, agentId });

  // Sin mensajes no hay nada que analizar. Se responde de forma controlada
  // indicando explícitamente que la sesión no tiene contenido recuperable.
  if (!messages || messages.length === 0) {
    return {
      sessionId,
      project,
      sessionExists: false,
      messageCount: 0,
      messages: [],
      instructions: {
        purpose: "Identificar información que pueda convertirse en memoria semántica durable",
        memoryTypes: MEMORY_TYPES,
      },
      candidates: [],
    };
  }

  const candidates = await extractCandidates(messages);

  return {
    sessionId,
    project,
    sessionExists: true,
    messageCount: messages.length,
    messages,
    instructions: {
      purpose: "Identificar información que pueda convertirse en memoria semántica durable",
      memoryTypes: MEMORY_TYPES,
    },
    candidates,
  };
}

/**
 * Analiza la conversación con el LLM y devuelve una lista de candidatos.
 * Es una función pura de extracción: no decide persistencia, desacoplada de
 * Engram y de cualquier proveedor concreto de memoria.
 * @param {Array} messages - Mensajes recuperados de Neon.
 * @returns {Promise<Array>} - Lista de candidatos.
 */
async function extractCandidates(messages) {
  // Gemini se obtiene dinámicamente: la API key se lee al momento de la llamada
  // (no al cargar el módulo) para soportar configuración tardía o rotación.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EXTRACT_MODEL });

  const transcript = messages
    .map((row) => `[msg ${row.id}] ${row.role.toUpperCase()}: ${row.content}`)
    .join("\n");

  const prompt = `
    Eres un experto en memoria semántica de conversaciones.
    Analiza la siguiente conversación y extrae ÚNICAMENTE los posibles CANDIDATOS a memoria durable con valor futuro.

    CATEGORÍAS PERMITIDAS:
    - decision: una elección que se tomó y su motivo.
    - discovery: un hallazgo o aprendizaje técnico.
    - constraint: una limitación o regla impuesta.
    - configuration: un cambio de configuración o setup.
    - lesson: una lección aprendida de una situación concreta.

    PRIORIZÁ conocimientos con valor futuro, por ejemplo:
    - decisiones arquitectónicas o técnicas;
    - configuraciones importantes;
    - descubrimientos sobre herramientas;
    - restricciones del proyecto;
    - errores y soluciones que puedan evitarse nuevamente;
    - patrones o convenciones adoptadas;
    - lecciones aprendidas;
    - información que pueda cambiar decisiones futuras.

    EVITÁ candidatos triviales como:
    - saludos;
    - preguntas comunes;
    - información temporal sin valor futuro;
    - mensajes redundantes;
    - contenido conversacional irrelevante.

    ESTRUCTURA REQUERIDA (JSON):
    {
      "candidates": [
        {
          "type": "decision | discovery | constraint | configuration | lesson",
          "title": "string corto y descriptivo",
          "what": "qué conocimiento se descubrió o se decidió",
          "why": "por qué importa / el motivo",
          "whereContext": "contexto o área a la que pertenece (ej: arquitectura, configuración, herramienta)",
          "learned": "aprendizaje o implicación para el futuro",
          "importance": "low | medium | high",
          "sourceMessageIds": ["msg-<id>", ...]
        }
      ]
    }

    'importance' es una ESTIMACIÓN de valor (low/medium/high), NO una decisión de persistencia.
    'sourceMessageIds' debe contener los prefijos de mensaje [msg <id>] presentes en la transcripción que respaldan cada candidato.
    Si NO hay nada con valor durable, devuelve { "candidates": [] }.
    NO incluyas introducciones, solo el objeto JSON puro.

    CONVERSACIÓN:
    ${transcript}
  `;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonString);
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];

    // Frontera de validación: LLM -> validación -> candidatos válidos.
    // Los candidatos inválidos se rechazan con su motivo (sin tumbar la
    // extracción) y nunca llegan a la auditoría ni a persistencia.
    const candidates = [];
    for (const raw of rawCandidates) {
      const verdict = validateCandidate(raw);
      if (!verdict.valid) {
        console.warn(`extractMemories: candidato rechazado - ${verdict.reason}`);
        continue;
      }
      candidates.push(buildCandidate(raw));
    }
    return candidates;
  } catch (err) {
    console.error("Error extracting memories with LLM:", err.message);
    return [];
  }
}

/**
 * Valida la estructura mínima de un candidato crudo del LLM.
 * No decide persistencia ni audita: solo determina si el candidato tiene la
 * forma esperada para que etapas posteriores (memoryAudit, memoryPromote)
 * puedan trabajar con él.
 * @param {*} candidate - Candidato tal como lo devolvió el LLM.
 * @returns {Object} { valid: boolean, reason?: string }.
 */
function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, reason: "Candidate is not an object" };
  }

  if (!VALID_TYPES.has(candidate.type)) {
    return { valid: false, reason: "Invalid candidate type" };
  }

  if (typeof candidate.title !== "string" || candidate.title.trim().length === 0) {
    return { valid: false, reason: "Candidate title is required" };
  }
  if (candidate.title.trim().length > MAX_TITLE_LENGTH) {
    return { valid: false, reason: "Candidate title is too long" };
  }

  if (typeof candidate.what !== "string" || candidate.what.trim().length === 0) {
    return { valid: false, reason: "Candidate what is required" };
  }
  if (candidate.what.trim().length > MAX_TEXT_FIELD_LENGTH) {
    return { valid: false, reason: "Candidate what is too long" };
  }

  if (!Array.isArray(candidate.sourceMessageIds)) {
    return { valid: false, reason: "Invalid sourceMessageIds" };
  }
  if (candidate.sourceMessageIds.length === 0) {
    return { valid: false, reason: "At least one sourceMessageId is required" };
  }
  for (const id of candidate.sourceMessageIds) {
    if (typeof id !== "string" || id.trim().length === 0) {
      return { valid: false, reason: "Invalid sourceMessageIds" };
    }
  }

  if (candidate.importance !== undefined && candidate.importance !== null && !VALID_IMPORTANCE.has(candidate.importance)) {
    return { valid: false, reason: "Invalid importance" };
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = candidate[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      return { valid: false, reason: `Invalid ${field}` };
    }
    if (value.trim().length > MAX_TEXT_FIELD_LENGTH) {
      return { valid: false, reason: `Candidate ${field} is too long` };
    }
  }

  return { valid: true };
}

/**
 * Normaliza un candidato ya validado: recorta textos, aplica los valores
 * permitidos y completa los opcionales ausentes. La salida mantiene la forma
 * del contrato existente (importance por defecto "medium", textos vacíos "").
 * @param {Object} candidate - Candidato validado.
 * @returns {Object} Candidato normalizado.
 */
function buildCandidate(candidate) {
  return {
    type: candidate.type,
    title: candidate.title.trim(),
    what: candidate.what.trim(),
    why: candidate.why == null ? "" : candidate.why.trim(),
    whereContext: candidate.whereContext == null ? "" : candidate.whereContext.trim(),
    learned: candidate.learned == null ? "" : candidate.learned.trim(),
    importance: candidate.importance == null ? "medium" : candidate.importance,
    sourceMessageIds: candidate.sourceMessageIds.map((id) => id.trim()),
  };
}

module.exports = extractMemories;
module.exports.extractMemories = extractMemories;
module.exports.MEMORY_TYPES = MEMORY_TYPES;
module.exports.validateCandidate = validateCandidate;
