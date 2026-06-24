// src/services/embeddingService.js

const { db } = require("../database");

// Specify the model and ensure it's quantized for efficiency
const model = "Xenova/all-MiniLM-L6-v2";
let extractor = null; // Will store the initialized pipeline
let initializationPromise = null; // New variable to store the initialization promise
let transformersModulePromise = null;

async function loadTransformers() {
  if (!transformersModulePromise) {
    transformersModulePromise = import("@xenova/transformers");
  }

  return transformersModulePromise;
}

/**
 * Initializes the embedding pipeline.
 * This should be called once at application startup.
 */
async function initializeEmbeddingPipeline() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const { pipeline } = await loadTransformers();
      console.log(`Loading embedding model: ${model}`);
      extractor = await pipeline("feature-extraction", model, { quantized: true });
      console.log("Embedding model loaded.");
    })();
  }
  return initializationPromise;
}

/**
 * Genera un embedding enriquecido para un objeto de mensaje dado.
 * @param {Object} message - El objeto de mensaje que contiene 'role' y 'content'.
 * @returns {Promise<string>} A JSON string representation of the embedding vector.
 */
async function generateEmbedding(message) {
  if (!extractor) {
    // Ensure the pipeline is initialized before use.
    await initializeEmbeddingPipeline();
  }

  // Enriquecer: concatenamos rol + contenido para dar más contexto semántico
  const enrichedText = `${message.role}: ${message.content}`;

  // Generate embeddings
  const output = await extractor(enrichedText, { pooling: "mean", normalize: true });
  // The output is typically a Tensor. Convert it to a plain array.
  const embedding = output.data; // This gets the raw data from the Tensor
  return JSON.stringify(Array.from(embedding)); // Convert TypedArray to standard Array and then to JSON string
}

/**
 * Saves an embedding associated with a message ID to the database.
 * @param {string} messageId The ID of the message.
 * @param {string} embedding The JSON string representation of the embedding.
 * @returns {Promise<void>}
 */
async function saveEmbedding(messageId, embedding) {
  try {
    // The 'embedding' parameter is already a JSON string from generateEmbedding
    await db.runAsync(
      `INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)
       ON CONFLICT(message_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [messageId, embedding] // embedding ya viene como JSON string
    );
    console.log(`Embedding for message ${messageId} saved to message_embeddings.`);
  } catch (err) {
    console.error("Error saving embedding to message_embeddings:", err.message);
    throw err;
  }
}

async function getEmbedding(messageId) {
  const row = await db.getAsync(
    `SELECT embedding FROM message_embeddings WHERE message_id = $1`,
    [messageId]
  );
  return row ? row.embedding : null;
}

module.exports = {
  initializeEmbeddingPipeline,
  generateEmbedding,
  saveEmbedding,
  getEmbedding,
};
