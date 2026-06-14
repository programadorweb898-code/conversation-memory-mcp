const db = require("../database");
const { v4: uuidv4 } = (await import("uuid")).v4;
const { z } = require("zod");
const embeddingService = require("../services/embeddingService");
const embeddingQueue = require("../services/embeddingQueue");

const SaveMessageSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1).optional().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  agentId: z.string().optional(),
});

async function saveMessage(params) {
  const validatedParams = SaveMessageSchema.parse(params);
  const { sessionId, project, role, content, agentId } = validatedParams;
  const messageId = uuidv4();

  try {
    const sql = `
      INSERT INTO conversations
      (id, session_id, timestamp, project, role, content, agent_id)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    `;

    await db.runAsync(sql, [messageId, sessionId, project ?? null, role, content, agentId ?? null]);
  } catch (err) {
    console.error("Error saving message:", err.message);
    throw err;
  }

  // Add embedding generation to the queue
  embeddingQueue.addTask({ messageId, content });
  console.log(`Embedding task for message ${messageId} queued.`);

  return true;
}

module.exports = saveMessage;
module.exports.saveMessage = saveMessage;
module.exports.SaveMessageSchema = SaveMessageSchema;
