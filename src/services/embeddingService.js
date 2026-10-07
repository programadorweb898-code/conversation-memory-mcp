// src/services/embeddingService.js

const { db } = require("../database");
const { getConfig } = require("../config");
const logger = require("../logger");
const {
  createRetryablePromise,
  EmbeddingInfrastructureError,
  assertEmbeddingProvider,
} = require("./embeddingProvider");
const { createTransformersEmbeddingProvider } = require("./embeddingProviders/transformersProvider");

const embeddingProvider = assertEmbeddingProvider(
  createTransformersEmbeddingProvider({ logger }),
);

function isEmbeddingsEnabled() {
  return getConfig().embeddings.enabled;
}

const {
  minChars: MIN_EMBEDDING_CHARS,
  maxChars: MAX_EMBEDDING_CHARS,
} = getConfig().embeddings;

// El modelo trunca en silencio a 512 tokens (~2000 caracteres): indexar el
// contenido completo de un mensaje largo produce un embedding que solo
// representa su inicio. Recortamos de forma explícita para que el vector sea
// interpretable y para no gastar cómputo de más.
function prepareForEmbedding(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length < MIN_EMBEDDING_CHARS) return null;
  return text.slice(0, MAX_EMBEDDING_CHARS);
}

/**
 * Initializes the embedding provider.
 * This should be called once at application startup.
 */
async function initializeEmbeddingPipeline() {
  if (!isEmbeddingsEnabled()) {
    const error = new Error("Embeddings están deshabilitados por ENABLE_EMBEDDINGS=false.");
    error.code = "EMBEDDINGS_DISABLED";
    throw error;
  }

  return embeddingProvider.initialize();
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

  const enrichedText = `${message.role}: ${message.content}`;
  const [embedding] = await embeddingProvider.embed(enrichedText);

  return JSON.stringify(embedding);
}

/**
 * Genera embeddings enriquecidos por lote.
 * @param {Array<Object>} messages
 * @returns {Promise<string[]>} JSON strings, uno por mensaje.
 */
async function generateEmbeddings(messages) {
  if (!isEmbeddingsEnabled()) {
    const error = new Error("Embeddings están deshabilitados por ENABLE_EMBEDDINGS=false.");
    error.code = "EMBEDDINGS_DISABLED";
    throw error;
  }

  const enrichedTexts = messages.map((message) => `${message.role}: ${message.content}`);
  const embeddings = await embeddingProvider.embed(enrichedTexts);

  return embeddings.map((embedding) => JSON.stringify(embedding));
}

function getEmbeddingMetadata() {
  return embeddingProvider.getMetadata();
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
      [messageId, embeddingValue],
    );
    logger.log(`Embedding for message ${messageId} saved to message_embeddings.`);
  } catch (err) {
    logger.error("Error saving embedding to message_embeddings:", err.message);
    throw err;
  }
}

async function getEmbedding(messageId) {
  const row = await db.getAsync(
    "SELECT embedding::text AS embedding FROM message_embeddings WHERE message_id = $1",
    [messageId],
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
  getEmbeddingMetadata,
  EmbeddingInfrastructureError,
  createRetryablePromise,
  MIN_EMBEDDING_CHARS,
  MAX_EMBEDDING_CHARS,
};
