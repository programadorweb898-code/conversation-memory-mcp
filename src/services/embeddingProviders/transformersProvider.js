// src/services/embeddingProviders/transformersProvider.js

const {
  createRetryablePromise,
  EmbeddingInfrastructureError,
} = require("../embeddingProvider");

const DEFAULT_MODEL = "Xenova/multilingual-e5-small";
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_DTYPE = "q8";
const DEFAULT_VERSION = 1;
const INPUT_PREFIXES = {
  query: "query: ",
  passage: "passage: ",
};

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

function formatInputText(text, inputType = "passage") {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("El texto del embedding debe ser un string no vacío.");
  }

  const prefix = INPUT_PREFIXES[inputType];
  if (!prefix) {
    throw new TypeError(`Tipo de entrada de embedding no soportado: ${inputType}.`);
  }

  return `${prefix}${text}`;
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
  version = DEFAULT_VERSION,
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

    async embed(texts, { inputType = "passage" } = {}) {
      const inputTexts = Array.isArray(texts) ? texts : [texts];

      if (
        inputTexts.length === 0 ||
        inputTexts.some((text) => typeof text !== "string" || text.length === 0)
      ) {
        throw new TypeError("embed() requiere al menos un texto no vacío.");
      }

      const formattedTexts = inputTexts.map((text) => formatInputText(text, inputType));

      if (!extractor) {
        await initializePipeline();
      }

      const output = await extractor(
        formattedTexts.length === 1 ? formattedTexts[0] : formattedTexts,
        { pooling: "mean", normalize: true },
      );

      const flattened = flattenEmbeddingData(output?.data);
      const expectedValues = formattedTexts.length * dimensions;

      if (flattened.length !== expectedValues) {
        const actualDimensions = formattedTexts.length > 0 && flattened.length % formattedTexts.length === 0
          ? flattened.length / formattedTexts.length
          : flattened.length;
        throw new Error(
          `El proveedor devolvió un vector de ${actualDimensions} dimensiones para ${formattedTexts.length} texto(s); se esperaban ${dimensions} dimensiones por texto.`,
        );
      }

      const embeddings = [];
      for (let index = 0; index < formattedTexts.length; index += 1) {
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
        version,
      };
    },
  };
}

module.exports = {
  createTransformersEmbeddingProvider,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_DTYPE,
  DEFAULT_VERSION,
  INPUT_PREFIXES,
  formatInputText,
  flattenEmbeddingData,
  validateVector,
};
