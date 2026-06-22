// src/services/embeddingWorker.js

const embeddingQueue = require("./embeddingQueue");
const embeddingService = require("./embeddingService");
const { db } = require("../database");

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
        SELECT id, content, role FROM conversations 
        WHERE id NOT IN (SELECT message_id FROM message_embeddings)
        LIMIT 1
      `);

      if (pendingMessage) {
        task = { messageId: pendingMessage.id, content: pendingMessage.content, role: pendingMessage.role };
      }
    }
// ... (rest of the file) ...
    if (task) {
      const { messageId, content, role } = task;
      console.log(`Processing embedding for message: ${messageId}`);
      
      // Ensure embedding pipeline is initialized before use
      await embeddingService.initializeEmbeddingPipeline();
      const generatedEmbedding = await embeddingService.generateEmbedding({ role, content });
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
  console.log("Starting embedding worker (model will load on first use)...");
  // NO cargar el modelo aquí - lazy load cuando se procese la primera tarea
  // Esto permite que Gemini CLI se conecte inmediatamente
  workerInterval = setInterval(processNextEmbeddingTask, workerIntervalMs);
}

function stopWorker() {
  console.log("Stopping embedding worker...");
  clearInterval(workerInterval);
}

module.exports = {
  startWorker,
  stopWorker,
};
