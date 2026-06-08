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

  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO conversations
      (id, session_id, timestamp, project, role, content, agent_id)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    `;
    
    db.run(sql, [messageId, sessionId, project, role, content, agentId], async (err) => {
      if (err) return reject(err);

      try {
        const generatedEmbedding = await embeddingService.generateEmbedding(content);
        await embeddingService.saveEmbedding(messageId, generatedEmbedding);
        resolve(true);
      } catch (embeddingErr) {
        console.error("Error generating embedding:", embeddingErr);
        // Resolvemos true porque el mensaje sí se guardó correctamente en DB
        resolve(true); 
      }
    });
  });
}

module.exports = saveMessage;
