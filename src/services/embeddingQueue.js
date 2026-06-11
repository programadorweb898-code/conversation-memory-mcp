// src/services/embeddingQueue.js

const embeddingQueue = [];
let processing = false; // Flag to prevent multiple workers processing the queue

/**
 * Adds a task to the embedding queue.
 * @param {object} task - The task to add, containing messageId and content.
 * @param {string} task.messageId
 * @param {string} task.content
 */
function addTask(task) {
  embeddingQueue.push(task);
  console.log(`Task added to embedding queue: ${task.messageId}. Queue size: ${embeddingQueue.length}`);
}

/**
 * Retrieves the next task from the embedding queue.
 * @returns {object|undefined} The next task, or undefined if the queue is empty.
 */
function getNextTask() {
  const task = embeddingQueue.shift();
  if (task) {
    console.log(`Task retrieved from embedding queue: ${task.messageId}. Remaining queue size: ${embeddingQueue.length}`);
  }
  return task;
}

/**
 * Checks if the queue is empty.
 * @returns {boolean} True if the queue is empty, false otherwise.
 */
function isEmpty() {
  return embeddingQueue.length === 0;
}

/**
 * Sets the processing flag to prevent multiple workers.
 * @param {boolean} status
 */
function setProcessingStatus(status) {
  processing = status;
}

/**
 * Gets the current processing status.
 * @returns {boolean}
 */
function getProcessingStatus() {
  return processing;
}


module.exports = {
  addTask,
  getNextTask,
  isEmpty,
  setProcessingStatus,
  getProcessingStatus,
};
