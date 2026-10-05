// src/services/embeddingQueue.js

const embeddingQueue = [];
let processing = false; // Flag to prevent multiple workers processing the queue
const configuredMaxQueueSize = Number(process.env.EMBEDDING_QUEUE_MAX_SIZE || 1000);
const maxQueueSize = Number.isInteger(configuredMaxQueueSize) && configuredMaxQueueSize > 0
  ? configuredMaxQueueSize
  : 1000;

/**
 * Adds a task to the embedding queue.
 * @param {object} task - The task to add, containing messageId, role, and content.
 * @param {string} task.messageId
 * @param {string} task.role
 * @param {string} task.content
 */
function addTask(task) {
  if (embeddingQueue.length >= maxQueueSize) {
    console.warn(`Embedding queue is full (${maxQueueSize}); message ${task.messageId} will be picked up from the database later.`);
    return false;
  }
  embeddingQueue.push(task);
  console.log(`Task added to embedding queue: ${task.messageId}. Queue size: ${embeddingQueue.length}`);
  return true;
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
 * Number of tasks waiting in memory. Only diagnostic: tasks are not durable,
 * so this is a hint of pending work, not a backlog guarantee.
 * @returns {number}
 */
function size() {
  return embeddingQueue.length;
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
  size,
  setProcessingStatus,
  getProcessingStatus,
};
