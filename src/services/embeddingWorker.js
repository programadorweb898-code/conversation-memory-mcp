// src/services/embeddingWorker.js

const embeddingQueue = require("./embeddingQueue");
const embeddingService = require("./embeddingService");
const { isEmbeddingsEnabled, prepareForEmbedding, MIN_EMBEDDING_CHARS } = require("./embeddingService");
const { db } = require("../database");
const { getConfig } = require("../config");

const embeddingConfig = getConfig().embeddings;
const initialPollIntervalMs = embeddingConfig.pollIntervalMs;
const maxPollIntervalMs = embeddingConfig.maxPollIntervalMs;
const maxEmbeddingAttempts = 3;
const batchSize = embeddingConfig.batchSize;
// Violación de clave foránea: el mensaje fue borrado mientras esperaba.
const FK_VIOLATION = "23503";

function isInfrastructureFailure(error) {
  const code = String(error?.code || "");
  return error?.retryable === true || code === "EMBEDDING_INFRASTRUCTURE" ||
    code.startsWith("08") || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "57P01", "53300"].includes(code);
}

// Si el mensaje ya no existe, no hay nada que registrar: embedding_failures
// tiene la misma FK contra conversations, así que intentar insertar también
// falla con 23503 y el error terminaba como rechazo sin manejar en el worker.
// Esta función nunca debe lanzar: es el último paso del manejo de errores.
async function recordEmbeddingFailure(messageId, error) {
  const errorMessage = error && error.message ? error.message : String(error);

  try {
    if (isInfrastructureFailure(error)) {
      console.error(`Embedding infrastructure unavailable; ${messageId} remains pending:`, errorMessage);
      return;
    }

    if (error && error.code === FK_VIOLATION) {
      console.log(`No se registra fallo de embedding para ${messageId}: el mensaje ya no existe.`);
      return;
    }

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
  } catch (failureError) {
    console.error(`No se pudo registrar el fallo de embedding para ${messageId}:`, failureError.message);
  }
}

async function processBatchSerially(batchTasks) {
  for (const task of batchTasks) {
    const messageId = task.messageId;
    try {
      const generatedEmbedding = await embeddingService.generateEmbedding({ role: task.role, content: task.content });
      console.log(`Processing embedding for message: ${messageId}`);
      await embeddingService.saveEmbedding(messageId, generatedEmbedding);
      await db.runAsync(`DELETE FROM embedding_failures WHERE message_id = $1`, [messageId]);
      console.log(`Successfully processed and saved embedding for message: ${messageId}`);
    } catch (error) {
      if (error && error.code === FK_VIOLATION) {
        console.log(`Descartada la tarea de ${messageId}: el mensaje ya no existe.`);
        continue;
      }
      if (isInfrastructureFailure(error)) {
        console.error(`Embedding infrastructure unavailable; ${messageId} remains pending:`, error.message);
        return false;
      }
      await recordEmbeddingFailure(messageId, error);
      console.error(`Error processing embedding for message ${messageId}:`, error);
    }
  }
  return true;
}

async function processNextEmbeddingTask() {
  if (embeddingQueue.getProcessingStatus()) {
    return false;
  }

  embeddingQueue.setProcessingStatus(true);

  let batchTasks = [];

  try {
    while (batchTasks.length < batchSize) {
      const queuedTask = embeddingQueue.getNextTask();
      if (queuedTask) {
        batchTasks.push(queuedTask);
        continue;
      }

      const pendingMessages = await db.allAsync(`
        SELECT c.id AS message_id, c.content, c.role
        FROM conversations c
        LEFT JOIN message_embeddings me ON me.message_id = c.id
        LEFT JOIN embedding_failures ef ON ef.message_id = c.id
        WHERE me.message_id IS NULL
          AND COALESCE(ef.attempts, 0) < $1
          AND length(btrim(c.content)) >= $3
        ORDER BY c.id
        LIMIT $2
      `, [maxEmbeddingAttempts, batchSize - batchTasks.length, MIN_EMBEDDING_CHARS]);

      if (pendingMessages.length === 0) {
        break;
      }

      batchTasks.push(...pendingMessages
        .map((row) => ({
          messageId: row.message_id,
          content: prepareForEmbedding(row.content),
          role: row.role,
        }))
        .filter((task) => task.content !== null));
      break;
    }

    batchTasks = [...new Map(batchTasks.map((task) => [task.messageId, task])).values()];

    if (batchTasks.length === 0) {
      return false;
    }

    console.log(`Processing embedding batch of ${batchTasks.length} messages.`);
    const generatedEmbeddings = await embeddingService.generateEmbeddings(batchTasks.map((task) => ({ role: task.role, content: task.content })));

    for (let index = 0; index < batchTasks.length; index += 1) {
      const task = batchTasks[index];
      const messageId = task.messageId;
      const generatedEmbedding = generatedEmbeddings[index];

      try {
        console.log(`Processing embedding for message: ${messageId}`);
        await embeddingService.saveEmbedding(messageId, generatedEmbedding);
        await db.runAsync(`DELETE FROM embedding_failures WHERE message_id = $1`, [messageId]);
        console.log(`Successfully processed and saved embedding for message: ${messageId}`);
      } catch (error) {
        if (error && error.code === FK_VIOLATION) {
          console.log(`Descartada la tarea de ${messageId}: el mensaje ya no existe.`);
          continue;
        }
        if (isInfrastructureFailure(error)) {
          console.error(`Embedding infrastructure unavailable; ${messageId} remains pending:`, error.message);
          return false;
        }
        await recordEmbeddingFailure(messageId, error);
        console.error(`Error processing embedding for message ${messageId}:`, error);
      }
    }
    return true;
  } catch (error) {
    console.error(`Error in embedding worker batch:`, error);
    if (isInfrastructureFailure(error) || batchTasks.length === 0) return false;
    return await processBatchSerially(batchTasks);
  } finally {
    embeddingQueue.setProcessingStatus(false);
  }
}

let workerTimer;
let workerTask;
let workerRunning = false;
let idlePollIntervalMs = initialPollIntervalMs;

function runWorkerTick() {
  if (workerTask) return workerTask;

  workerTask = processNextEmbeddingTask()
    .catch((error) => {
      console.error("Error inesperado en el worker de embeddings:", error);
    })
    .finally(() => {
      workerTask = undefined;
    });

  return workerTask;
}

function startWorker() {
  if (workerRunning) return;
  if (!isEmbeddingsEnabled()) {
    console.log("Embedding worker disabled by ENABLE_EMBEDDINGS=false.");
    return;
  }

  console.log("Starting embedding worker (model will load on first use)...");
  workerRunning = true;
  idlePollIntervalMs = initialPollIntervalMs;
  scheduleWorkerTick(idlePollIntervalMs);
}

function scheduleWorkerTick(delay) {
  if (!workerRunning) return;
  workerTimer = setTimeout(async () => {
    workerTimer = undefined;
    let didWork = false;
    try {
      didWork = await runWorkerTick();
    } catch (error) {
      console.error("Error inesperado en el worker de embeddings:", error);
    }

    idlePollIntervalMs = didWork
      ? initialPollIntervalMs
      : Math.min(maxPollIntervalMs, idlePollIntervalMs * 2);
    scheduleWorkerTick(idlePollIntervalMs);
  }, delay);
  workerTimer.unref?.();
}

async function stopWorker() {
  console.log("Stopping embedding worker...");
  workerRunning = false;
  clearTimeout(workerTimer);
  workerTimer = undefined;
  if (workerTask) await workerTask;
}

module.exports = {
  startWorker,
  stopWorker,
  runWorkerTick,
  processNextEmbeddingTask,
  recordEmbeddingFailure,
};
