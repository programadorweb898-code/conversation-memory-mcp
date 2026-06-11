// src/services/embeddingWorker.js

const embeddingQueue = require("./embeddingQueue");
const embeddingService = require("./embeddingService");

const workerIntervalMs = 1000; // Poll the queue every 1 second

async function processNextEmbeddingTask() {
  if (embeddingQueue.isEmpty() || embeddingQueue.getProcessingStatus()) {
    return;
  }

  embeddingQueue.setProcessingStatus(true);
  const task = embeddingQueue.getNextTask();

  if (task) {
    const { messageId, content } = task;
    console.log(`Processing embedding for message: ${messageId}`);
    try {
      // Ensure embedding pipeline is initialized before use
      await embeddingService.initializeEmbeddingPipeline();
      const generatedEmbedding = await embeddingService.generateEmbedding(content);
      await embeddingService.saveEmbedding(messageId, generatedEmbedding);
      console.log(`Successfully processed and saved embedding for message: ${messageId}`);
    } catch (error) {
      console.error(`Error processing embedding for message ${messageId}:`, error);
      // Depending on policy, you might want to re-add the task to the queue
      // or move it to a dead-letter queue. For now, we just log the error.
    } finally {
      embeddingQueue.setProcessingStatus(false);
    }
  } else {
    embeddingQueue.setProcessingStatus(false);
  }
}

let workerInterval;

function startWorker() {
  console.log("Starting embedding worker...");
  // Initialize the embedding pipeline once when the worker starts
  embeddingService.initializeEmbeddingPipeline()
    .then(() => {
      console.log("Embedding pipeline initialized for worker.");
      workerInterval = setInterval(processNextEmbeddingTask, workerIntervalMs);
    })
    .catch(error => {
      console.error("Failed to initialize embedding pipeline for worker:", error);
      // Potentially retry initialization or stop the worker if critical
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
