// Fábrica de adaptadores de memoria. Punto de extensión para futuros
// proveedores (EngramCloudAdapter, etc.) sin acoplar la lógica de auditoría.
const { EngramLocalAdapter } = require("./engramLocalAdapter");

const DEFAULT_PROVIDER = "engram-local";

const MEMORY_PROVIDERS = {
  "engram-local": (options) => new EngramLocalAdapter(options),
};

/**
 * @typedef {Object} MemoryCandidate
 * @property {string} id - Id estable del candidato auditado.
 * @property {string} project - Proyecto al que pertenece la conversación.
 * @property {string} sessionId - Sesión de conversación de origen.
 * @property {string|null} [agentId] - Agente que originó el mensaje.
 * @property {string} type - Tipo de memoria (decision, discovery, constraint, configuration, lesson).
 * @property {string} title - Título de la memoria.
 * @property {string} [what] - Qué conocimiento se descubrió o decidió.
 * @property {string} [why] - Por qué importa.
 * @property {string} [whereContext] - Contexto o área.
 * @property {string} [learned] - Aprendizaje para el futuro.
 * @property {string} [importance] - Estimación de valor (low|medium|high).
 * @property {string[]} [sourceMessageIds] - Mensajes de origen que respaldan el candidato.
 * @property {string} [topicKey] - Topic key del candidato (si lo tiene).
 */

/**
 * @typedef {Object} PromoteOptions
 * @property {string} [idempotencyKey] - Clave de idempotencia que el llamador
 * (memoryPromote) provee para que el adaptador/proveedor la use cuando tenga
 * soporte real. Opcional y agnóstica al proveedor.
 */

/**
 * @typedef {Object} PromoteResult
 * @property {boolean} success - true si el proveedor persistió la memoria.
 * @property {string} [memoryId] - Identificador de la memoria en el proveedor (éxito).
 * @property {string} [topicKey] - Topic key devuelta por el proveedor, si existe (éxito).
 * @property {Object} [metadata] - Metadatos adicionales del proveedor (éxito).
 * @property {string} [error] - Mensaje descriptivo del fallo (fallo).
 * @property {boolean} [retryable] - true si el fallo es recuperable (fallo).
 */

/**
 * Devuelve el adaptador de memoria activo según MEMORY_PROVIDER.
 * Interfaz MemoryAdapter:
 *   - getStatus(): estado del proveedor (nunca lanza).
 *   - searchRelated({query, project, limit}): memorias similares (lanza en fallo).
 *   - promote(candidate, options?): persiste un candidato AUDITADO como memoria
 *     durable en el proveedor. Devuelve un resultado normalizado (PromoteResult)
 *     en lugar de lanzar excepciones del proveedor. NO extrae, NO audita, NO
 *     decide, NO busca duplicados (el find-before-create es best-effort interno)
 *     y NUNCA escribe en memory_candidates ni en Neon.
 * @returns {Object} Adaptador con la interfaz MemoryAdapter.
 */
function getMemoryAdapter() {
  const provider = process.env.MEMORY_PROVIDER || DEFAULT_PROVIDER;
  const factory = MEMORY_PROVIDERS[provider];
  if (typeof factory !== "function") {
    throw new Error(`Proveedor de memoria desconocido: ${provider}`);
  }
  return factory();
}

module.exports = { getMemoryAdapter, MEMORY_PROVIDERS, DEFAULT_PROVIDER };