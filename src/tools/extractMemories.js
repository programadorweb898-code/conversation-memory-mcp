const { GoogleGenerativeAI } = require("@google/generative-ai");
const recoverSession = require("./recoverSession");

const MEMORY_TYPES = ["decision", "discovery", "constraint", "configuration", "lesson"];

// Inicializar Gemini (mismo patrón que generateSessionSummary)
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

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
  if (!genAI) return [];

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

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
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    return candidates.map(normalizeCandidate);
  } catch (err) {
    console.error("Error extracting memories with LLM:", err.message);
    return [];
  }
}

/**
 * Normaliza un candidato crudo del LLM asegurando la estructura y los
 * valores permitidos. Descarta candidatos inválidos.
 * @param {Object} raw - Candidato tal como lo devolvió el LLM.
 * @returns {Object|null} - Candidato normalizado o null si es inválido.
 */
function normalizeCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;

  const type = MEMORY_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;

  const importance = ["low", "medium", "high"].includes(raw.importance)
    ? raw.importance
    : "medium";

  return {
    type,
    title: String(raw.title || "").trim(),
    what: String(raw.what || "").trim(),
    why: String(raw.why || "").trim(),
    whereContext: String(raw.whereContext || "").trim(),
    learned: String(raw.learned || "").trim(),
    importance,
    sourceMessageIds: Array.isArray(raw.sourceMessageIds) ? raw.sourceMessageIds : [],
  };
}

module.exports = extractMemories;
module.exports.extractMemories = extractMemories;
module.exports.MEMORY_TYPES = MEMORY_TYPES;
