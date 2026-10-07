// src/services/embeddingProviders/transformersProvider.js

const {
  createRetryablePromise,
  EmbeddingInfrastructureError,
} = require("../embeddingProvider");

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_DTYPE = "q8";

function flattenEmbeddingData(data) {
  if (Array.isArray(data)) {
    return data.flat(Infinity);
  }
  return Array.from(data || []);
}

function validateVector(vector, dimensions) {
  if (vector.length !== dimensions) {
    throw new Error(
      `El proveedor devolvió un vector de ${vector.length} dimensiones; se esperaban ${dimensions}.`,
    );
  }

  if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("El proveedor devolvió un embedding con valores no numéricos.");
  }

  return vector;
}

/**
 * Implementación concreta basada en Transformers.js.
 *
 * La aplicación consume el contrato definido por embeddingProvider.js y no
 * necesita conocer pipeline(), pooling, normalize, cuantización ni el modelo.
 */
function createTransformersEmbeddingProvider({
  model = DEFAULT_MODEL,
  dimensions = DEFAULT_DIMENSIONS,
  dtype = DEFAULT_DTYPE,
  loadTransformers: loadTransformersFactory = () => import("@huggingface/transformers"),
  logger = console,
} = {}) {
  let extractor = null;

  const loadTransformers = createRetryablePromise(loadTransformersFactory);

  const initializePipeline = createRetryablePromise(async () => {
    try {
      const { pipeline } = await loadTransformers();

      if (typeof pipeline !== "function") {
        throw new Error("Transformers.js no expuso una función pipeline válida.");
      }

      logger.log(`Loading embedding model: ${model}`);
      extractor = await pipeline("feature-extraction", model, { dtype });

      if (typeof extractor !== "function") {
        throw new Error("Transformers.js no devolvió un extractor válido.");
      }

      logger.log("Embedding model loaded.");
    } catch (error) {
      extractor = null;
      if (error?.code === "EMBEDDING_INFRASTRUCTURE") {
        throw error;
      }
      throw new EmbeddingInfrastructureError(error);
    }
  });

  return {
    async initialize() {
      return initializePipeline();
    },

    async embed(texts) {
      const inputTexts = Array.isArray(texts) ? texts : [texts];

      if (
        inputTexts.length === 0 ||
        inputTexts.some((text) => typeof text !== "string" || text.length === 0)
      ) {
        throw new TypeError("embed() requiere al menos un texto no vacío.");
      }

      if (!extractor) {
        await initializePipeline();
      }

      const output = await extractor(
        inputTexts.length === 1 ? inputTexts[0] : inputTexts,
        { pooling: "mean", normalize: true },
      );

      const flattened = flattenEmbeddingData(output?.data);
      const expectedValues = inputTexts.length * dimensions;

      if (flattened.length !== expectedValues) {
        const actualDimensions = inputTexts.length > 0 && flattened.length % inputTexts.length === 0
          ? flattened.length / inputTexts.length
          : flattened.length;
        throw new Error(
          `El proveedor devolvió un vector de ${actualDimensions} dimensiones para ${inputTexts.length} texto(s); se esperaban ${dimensions} dimensiones por texto.`,
        );
      }

      const embeddings = [];
      for (let index = 0; index < inputTexts.length; index += 1) {
        const start = index * dimensions;
        const vector = flattened.slice(start, start + dimensions);
        embeddings.push(validateVector(vector, dimensions));
      }

      return embeddings;
    },

    getMetadata() {
      return {
        provider: "transformers.js",
        model,
        dimensions,
        dtype,
      };
    },
  };
}

module.exports = {
  createTransformersEmbeddingProvider,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_DTYPE,
  flattenEmbeddingData,
  validateVector,
};
