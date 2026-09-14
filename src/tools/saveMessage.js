const { db } = require("../database");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const embeddingQueue = require("../services/embeddingQueue");
const { resolveWriteOwner } = require("../context");

const SaveMessageSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  agentId: z.string().optional(),
  relatedMessageId: z.string().optional().nullable(),
  owner: z.string().optional(),
});

async function saveMessage(params) {
  const validatedParams = SaveMessageSchema.parse(params);
  const { sessionId, project, role, content, agentId, relatedMessageId, owner } = validatedParams;

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
  } catch {
    // No es JSON, asumimos que es texto plano de conversación
  }

  const messageId = randomUUID();

  // El owner de CHECK es el autenticado crudo: si es admin (undefined/null) no
  // se valida propiedad, solo el proyecto. El owner que se PERSISTE nunca es
  // null (columna NOT NULL): cae al dueño por defecto si no hay auth.
  const authOwner = owner || null;
  const writeOwner = resolveWriteOwner(owner);

  const existingSessionProject = await db.getAsync(
    `SELECT project, owner FROM conversations WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  if (existingSessionProject && existingSessionProject.project !== project) {
    const error = new Error(
      `La sesión ${sessionId} ya pertenece al proyecto "${existingSessionProject.project}". No se permite mezclar datos entre proyectos.`
    );
    error.code = "PROJECT_CONFLICT";
    throw error;
  }

  if (existingSessionProject && authOwner && existingSessionProject.owner !== authOwner) {
    const error = new Error(`La sesión ${sessionId} ya existe y no pertenece a este usuario.`);
    error.code = "OWNER_CONFLICT";
    throw error;
  }

  try {
    const sql = `
      INSERT INTO conversations
      (id, session_id, timestamp, project, role, content, agent_id, related_message_id, owner)
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8)
    `;

    await db.runAsync(sql, [messageId, sessionId, project ?? null, role, content, agentId ?? null, relatedMessageId ?? null, writeOwner]);
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
