const db = require("../database");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");
const embeddingService = require("../services/embeddingService");

const SaveMessageSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
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

    await db.runAsync(sql, [messageId, sessionId, project, role, content, agentId]);
  } catch (err) {
    console.error("Error saving message:", err.message);
    throw err;
  }

  try {
    const generatedEmbedding = await embeddingService.generateEmbedding(content);
    await embeddingService.saveEmbedding(messageId, generatedEmbedding);
  } catch (embeddingErr) {
    console.error("Error generating embedding:", embeddingErr);
    // Return success because the message was already persisted.
  }

  return true;
}

module.exports = saveMessage;
