// src/services/embeddingWorker.js

const embeddingQueue = require("./embeddingQueue");
const embeddingService = require("./embeddingService");
const db = require("../database");

const workerIntervalMs = 5000; // Poll the database/queue every 5 seconds

async function processNextEmbeddingTask() {
  if (embeddingQueue.getProcessingStatus()) {
    return;
  }

  embeddingQueue.setProcessingStatus(true);

  try {
    let task = embeddingQueue.getNextTask();

    // Si la cola en memoria está vacía, buscamos en la base de datos mensajes sin embedding
    if (!task) {
      const pendingMessage = await db.getAsync(`
        SELECT id, content FROM conversations 
        WHERE id NOT IN (SELECT message_id FROM message_embeddings)
        LIMIT 1
      `);

      if (pendingMessage) {
        task = { messageId: pendingMessage.id, content: pendingMessage.content };
      }
    }

    if (task) {
      const { messageId, content } = task;
      console.log(`Processing embedding for message: ${messageId}`);
      
      // Ensure embedding pipeline is initialized before use
      await embeddingService.initializeEmbeddingPipeline();
      const generatedEmbedding = await embeddingService.generateEmbedding(content);
      await embeddingService.saveEmbedding(messageId, generatedEmbedding);
      console.log(`Successfully processed and saved embedding for message: ${messageId}`);
    }
  } catch (error) {
    console.error(`Error in embedding worker:`, error);
  } finally {
    embeddingQueue.setProcessingStatus(false);
  }
}

let workerInterval;

function startWorker() {
  console.log("Starting resilient embedding worker...");
  // Initialize the embedding pipeline once when the worker starts
  embeddingService.initializeEmbeddingPipeline()
    .then(() => {
      console.log("Embedding pipeline initialized for worker.");
      // Ejecutar inmediatamente y luego cada intervalo
      processNextEmbeddingTask();
      workerInterval = setInterval(processNextEmbeddingTask, workerIntervalMs);
    })
    .catch(error => {
      console.error("Failed to initialize embedding pipeline for worker:", error);
    });
}

function stopWorker() {
  console.log("Stopping embedding worker...");
  clearInterval(workerInterval);
}

module.exports = {
  startWorker,
  stopWorker,
};
