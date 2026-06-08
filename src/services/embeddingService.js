// src/services/embeddingService.js

const db = require("../database");
const { pipeline } = require("@xenova/transformers"); // Import pipeline

// Specify the model and ensure it's quantized for efficiency
const model = "Xenova/all-MiniLM-L6-v2";
let extractor = null; // Will store the initialized pipeline

/**
 * Initializes the embedding pipeline.
 * This should be called once at application startup.
 */
async function initializeEmbeddingPipeline() {
  if (!extractor) {
    console.log(`Loading embedding model: ${model}`);
    extractor = await pipeline("feature-extraction", model, { quantized: true });
    console.log("Embedding model loaded.");
  }
}

/**
 * Generates an embedding for a given text using Hugging Face Transformers.js.
 * @param {string} text The text to embed.
 * @returns {string} A JSON string representation of the embedding vector.
 */
async function generateEmbedding(text) {
  if (!extractor) {
    // Ensure the pipeline is initialized before use.
    // In a production app, initializeEmbeddingPipeline should be called once at startup.
    await initializeEmbeddingPipeline();
  }

  // Generate embeddings
  const output = await extractor(text, { pooling: "mean", normalize: true });
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
    await db.runAsync(
      `INSERT OR REPLACE INTO message_embeddings (message_id, embedding) VALUES (?, ?)`,
      [messageId, embedding]
    );
    console.log(`Embedding for message ${messageId} saved.`);
  } catch (err) {
    console.error("Error saving embedding:", err.message);
    throw err;
  }
}

/**
 * Retrieves an embedding for a given message ID from the database.
 * @param {string} messageId The ID of the message.
 * @returns {Promise<string|null>} The JSON string representation of the embedding, or null if not found.
 */
async function getEmbedding(messageId) {
  try {
    const row = await db.getAsync(
      `SELECT embedding FROM message_embeddings WHERE message_id = ?`,
      [messageId]
    );
    return row ? row.embedding : null;
  } catch (err) {
    console.error("Error retrieving embedding:", err.message);
    throw err;
  }
}

module.exports = {
  initializeEmbeddingPipeline, // Export the initialization function
  generateEmbedding,
  saveEmbedding,
  getEmbedding,
};
