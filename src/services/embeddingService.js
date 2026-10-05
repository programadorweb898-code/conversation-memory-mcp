// src/services/embeddingService.js

const { db } = require("../database");
const logger = require("../logger");

// Specify the model and ensure it's quantized for efficiency
const model = "Xenova/all-MiniLM-L6-v2";
let extractor = null;

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
    super(`No se pudo inicializar el modelo de embeddings: ${error.message}`, { cause: error });
    this.name = "EmbeddingInfrastructureError";
    this.code = "EMBEDDING_INFRASTRUCTURE";
    this.retryable = true;
  }
}

function isEmbeddingsEnabled() {
  return process.env.ENABLE_EMBEDDINGS !== "false";
}

function asInfrastructureError(error) {
  return error?.code === "EMBEDDING_INFRASTRUCTURE"
    ? error
    : new EmbeddingInfrastructureError(error);
}

// El modelo trunca en silencio a 512 tokens (~2000 caracteres): indexar el
// contenido completo de un mensaje largo produce un embedding que solo
// representa su inicio. Recortamos de forma explícita para que el vector sea
// interpretable y para no gastar cómputo de más.
const MIN_EMBEDDING_CHARS = Number(process.env.MIN_EMBEDDING_CHARS || 10);
const MAX_EMBEDDING_CHARS = Number(process.env.MAX_EMBEDDING_CHARS || 2000);

/**
 * Decide si un mensaje vale la pena ser indexado y devuelve el texto a
 * embeber. Los turnos triviales ("ok", "dale", "sí") no aportan nada al
 * Recall y solo cargan el índice y compiten en el reranking.
 * @param {string} content
 * @returns {string|null} Texto a embeber, o null si no corresponde indexar.
 */
function prepareForEmbedding(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length < MIN_EMBEDDING_CHARS) return null;
  return text.slice(0, MAX_EMBEDDING_CHARS);
}

const loadTransformers = createRetryablePromise(
  () => import("@huggingface/transformers"),
  () => {}
);

const initializePipeline = createRetryablePromise(async () => {
  try {
    const { pipeline } = await loadTransformers();
    logger.log(`Loading embedding model: ${model}`);
    extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
    logger.log("Embedding model loaded.");
  } catch (error) {
    extractor = null;
    throw asInfrastructureError(error);
  }
});

/**
 * Initializes the embedding pipeline.
 * This should be called once at application startup.
 */
async function initializeEmbeddingPipeline() {
  if (!isEmbeddingsEnabled()) {
    const error = new Error("Embeddings están deshabilitados por ENABLE_EMBEDDINGS=false.");
    error.code = "EMBEDDINGS_DISABLED";
    throw error;
  }

  return initializePipeline();
}

/**
 * Genera un embedding enriquecido para un objeto de mensaje dado.
 * @param {Object} message - El objeto de mensaje que contiene 'role' y 'content'.
 * @returns {Promise<string>} A JSON string representation of the embedding vector.
 */
async function generateEmbedding(message) {
  if (!isEmbeddingsEnabled()) {
    const error = new Error("Embeddings están deshabilitados por ENABLE_EMBEDDINGS=false.");
    error.code = "EMBEDDINGS_DISABLED";
    throw error;
  }

  if (!extractor) {
    await initializeEmbeddingPipeline();
  }

  const enrichedText = `${message.role}: ${message.content}`;
  const output = await extractor(enrichedText, { pooling: "mean", normalize: true });
  return JSON.stringify(Array.from(output.data));
}

async function generateEmbeddings(messages) {
  if (!isEmbeddingsEnabled()) {
    const error = new Error("Embeddings están deshabilitados por ENABLE_EMBEDDINGS=false.");
    error.code = "EMBEDDINGS_DISABLED";
    throw error;
  }

  if (!extractor) {
    await initializeEmbeddingPipeline();
  }

  const enrichedTexts = messages.map((message) => `${message.role}: ${message.content}`);
  const output = await extractor(enrichedTexts, { pooling: "mean", normalize: true });

  const rows = Array.isArray(output?.data) ? output.data : Array.from(output?.data || []);
  const batchSize = enrichedTexts.length;
  if (rows.length === batchSize) {
    return enrichedTexts.map((_, index) => JSON.stringify(Array.from(rows[index] || [])));
  }

  const flattened = Array.from(output?.data || []);
  const embeddings = [];
  const embeddingSize = flattened.length / batchSize;
  for (let index = 0; index < batchSize; index += 1) {
    const start = index * embeddingSize;
    const end = start + embeddingSize;
    embeddings.push(JSON.stringify(Array.from(flattened.slice(start, end))));
  }
  return embeddings;
}

/**
 * Saves an embedding associated with a message ID to the database.
 * @param {string} messageId The ID of the message.
 * @param {string} embedding The JSON string representation of the embedding.
 * @returns {Promise<void>}
 */
async function saveEmbedding(messageId, embedding) {
  try {
    const parsedEmbedding = typeof embedding === "string" ? JSON.parse(embedding) : embedding;
    const embeddingValue = Array.isArray(parsedEmbedding) ? `[${parsedEmbedding.join(",")}]` : embedding;

    await db.runAsync(
      `INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)
       ON CONFLICT(message_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [messageId, embeddingValue]
    );
    logger.log(`Embedding for message ${messageId} saved to message_embeddings.`);
  } catch (err) {
    logger.error("Error saving embedding to message_embeddings:", err.message);
    throw err;
  }
}

async function getEmbedding(messageId) {
  const row = await db.getAsync(
    `SELECT embedding::text AS embedding FROM message_embeddings WHERE message_id = $1`,
    [messageId]
  );
  return row ? row.embedding : null;
}

module.exports = {
  initializeEmbeddingPipeline,
  generateEmbedding,
  generateEmbeddings,
  saveEmbedding,
  getEmbedding,
  prepareForEmbedding,
  isEmbeddingsEnabled,
  EmbeddingInfrastructureError,
  createRetryablePromise,
  MIN_EMBEDDING_CHARS,
  MAX_EMBEDDING_CHARS,
};
