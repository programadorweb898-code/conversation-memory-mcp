// src/services/embeddingWorker.js

const embeddingQueue = require("./embeddingQueue");
const embeddingService = require("./embeddingService");
const { db } = require("../database");

const workerIntervalMs = 5000; // Poll the database/queue every 5 seconds
const maxEmbeddingAttempts = 3;

async function recordEmbeddingFailure(messageId, error) {
  const errorMessage = error && error.message ? error.message : String(error);

  await db.runAsync(`
    INSERT INTO embedding_failures (message_id, attempts, last_error, last_attempt_at)
    VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(message_id) DO UPDATE SET
      attempts = embedding_failures.attempts + 1,
      last_error = EXCLUDED.last_error,
      last_attempt_at = CURRENT_TIMESTAMP
  `, [messageId, errorMessage]);

  const failureRow = await db.getAsync(
    `SELECT attempts FROM embedding_failures WHERE message_id = $1`,
    [messageId]
  );

  const attempts = failureRow ? Number(failureRow.attempts) : 1;
  if (attempts >= maxEmbeddingAttempts) {
    console.log(`Mensaje ${messageId} descartado tras ${attempts} intentos fallidos de embedding, último error: ${errorMessage}`);
  }
}

async function processNextEmbeddingTask() {
  if (embeddingQueue.getProcessingStatus()) {
    return;
  }

  embeddingQueue.setProcessingStatus(true);
  let currentMessageId = null;

  try {
    let task = embeddingQueue.getNextTask();

    // Si la cola en memoria está vacía, buscamos en la base de datos mensajes sin embedding
    if (!task) {
      const pendingMessage = await db.getAsync(`
        SELECT c.id, c.content, c.role
        FROM conversations c
        LEFT JOIN message_embeddings me ON me.message_id = c.id
        LEFT JOIN embedding_failures ef ON ef.message_id = c.id
        WHERE me.message_id IS NULL
          AND COALESCE(ef.attempts, 0) < $1
        ORDER BY c.id
        LIMIT 1
      `, [maxEmbeddingAttempts]);

      if (pendingMessage) {
        task = { messageId: pendingMessage.id, content: pendingMessage.content, role: pendingMessage.role };
      }
    }

    if (task) {
      currentMessageId = task.messageId;
      const { messageId, content, role } = task;
      console.log(`Processing embedding for message: ${messageId}`);
      
      // Ensure embedding pipeline is initialized before use
      await embeddingService.initializeEmbeddingPipeline();
      const generatedEmbedding = await embeddingService.generateEmbedding({ role, content });
      await embeddingService.saveEmbedding(messageId, generatedEmbedding);
      await db.runAsync(`DELETE FROM embedding_failures WHERE message_id = $1`, [messageId]);
      console.log(`Successfully processed and saved embedding for message: ${messageId}`);
    }
  } catch (error) {
    if (currentMessageId) {
      await recordEmbeddingFailure(currentMessageId, error);
    }
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
