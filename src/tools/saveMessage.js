const { db } = require("../database");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const embeddingService = require("../services/embeddingService");
const embeddingQueue = require("../services/embeddingQueue");

const SaveMessageSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1).optional().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  agentId: z.string().optional(),
  relatedMessageId: z.string().optional().nullable(),
});

async function saveMessage(params) {
  const validatedParams = SaveMessageSchema.parse(params);
  const { sessionId, project, role, content, agentId, relatedMessageId } = validatedParams;

  // Filtrado de mensajes de infraestructura MCP
  try {
    const parsed = JSON.parse(content);
    if (parsed.jsonrpc === "2.0") {
      const ignoredMethods = [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
        "$/cancelRequest"
      ];
      if (parsed.method && ignoredMethods.includes(parsed.method)) {
        console.log(`Skipping MCP protocol message: ${parsed.method}`);
        return { success: true, messageId: null };
      }
    }
  } catch (e) {
    // No es JSON, asumimos que es texto plano de conversación
  }

  const messageId = randomUUID();
  try {
    const sql = `
      INSERT INTO conversations
      (id, session_id, timestamp, project, role, content, agent_id, related_message_id)
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7)
    `;

    await db.runAsync(sql, [messageId, sessionId, project ?? null, role, content, agentId ?? null, relatedMessageId ?? null]);
  } catch (err) {
    console.error("Error saving message:", err.message);
    throw err;
  }

  // Add embedding generation to the queue
  embeddingQueue.addTask({ messageId, content, role });
  console.log(`Embedding task for message ${messageId} queued.`);

  return { success: true, messageId };
}

module.exports = saveMessage;
module.exports.saveMessage = saveMessage;
module.exports.SaveMessageSchema = SaveMessageSchema;
