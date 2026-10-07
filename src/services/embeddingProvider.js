// src/services/embeddingProvider.js

/**
 * Contrato mínimo para un proveedor de embeddings.
 *
 * El resto de la aplicación no necesita conocer cómo se genera el vector:
 * solo necesita inicializar el proveedor, generar uno o varios embeddings y
 * consultar sus metadatos.
 *
 * @typedef {Object} EmbeddingProvider
 * @property {() => Promise<void>} initialize
 * @property {(texts: string|string[], options?: {inputType?: string}) => Promise<number[][]>} embed
 * @property {() => {provider: string, model: string, dimensions: number, dtype?: string}} getMetadata
 */

function createRetryablePromise(factory, onFailure = () => {}) {
  let cachedPromise;

  return () => {
    if (!cachedPromise) {
      cachedPromise = Promise.resolve()
        .then(factory)
        .catch((error) => {
          cachedPromise = undefined;
          onFailure(error);
          throw error;
        });
    }

    return cachedPromise;
  };
}

class EmbeddingInfrastructureError extends Error {
  constructor(error) {
    super(
      `No se pudo inicializar el proveedor de embeddings: ${error?.message || String(error)}`,
      { cause: error },
    );
    this.name = "EmbeddingInfrastructureError";
    this.code = "EMBEDDING_INFRASTRUCTURE";
    this.retryable = true;
  }
}

function assertEmbeddingProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("El proveedor de embeddings debe ser un objeto.");
  }

  for (const method of ["initialize", "embed", "getMetadata"]) {
    if (typeof provider[method] !== "function") {
      throw new TypeError(`El proveedor de embeddings debe implementar ${method}().`);
    }
  }

  const metadata = provider.getMetadata();
  if (!metadata || typeof metadata !== "object") {
    throw new TypeError("getMetadata() debe devolver un objeto.");
  }

  if (!Number.isInteger(metadata.dimensions) || metadata.dimensions <= 0) {
    throw new TypeError("Los metadatos del proveedor deben incluir una dimensión positiva.");
  }

  if (!metadata.provider || !metadata.model) {
    throw new TypeError("Los metadatos del proveedor deben incluir provider y model.");
  }

  return provider;
}

module.exports = {
  createRetryablePromise,
  EmbeddingInfrastructureError,
  assertEmbeddingProvider,
};
