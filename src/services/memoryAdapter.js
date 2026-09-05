// Fábrica de adaptadores de memoria. Punto de extensión para futuros
// proveedores (EngramCloudAdapter, etc.) sin acoplar la lógica de auditoría.
const { EngramLocalAdapter } = require("./engramLocalAdapter");

const DEFAULT_PROVIDER = "engram-local";

const MEMORY_PROVIDERS = {
  "engram-local": (options) => new EngramLocalAdapter(options),
};

/**
 * Devuelve el adaptador de memoria activo según MEMORY_PROVIDER.
 * Interfaz MemoryAdapter:
 *   - getStatus(): estado del proveedor (nunca lanza).
 *   - searchRelated({query, project, limit}): memorias similares (lanza en fallo).
 *   - promote(candidate): crea la memoria en el proveedor, devuelve { id, topicKey }.
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