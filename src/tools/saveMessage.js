const { withAdvisoryLock } = require("../database");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const embeddingQueue = require("../services/embeddingQueue");
const { isEmbeddingsEnabled, prepareForEmbedding } = require("../services/embeddingService");
const { resolveWriteOwner } = require("../context");

const SaveMessageSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
  projectPath: z.string().optional().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  agentId: z.string().optional(),
  relatedMessageId: z.string().optional().nullable(),
  sourceMessageId: z.string().min(1).optional(),
  owner: z.string().optional(),
});

// Un project inválido (raíz, ruta, Current-Directory) rompe el aislamiento por
// proyecto: mezcla datos de repositorios distintos bajo una misma clave. Es
// mejor rechazar el turno que guardar bajo una clave que después no se puede
// recuperar con fiabilidad.
const INVALID_PROJECT = /[\\/]|^[.]{1,2}$/;

function isMcpProtocolNoise(content) {
  if (!content || typeof content !== "string") return false;

  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.jsonrpc === "2.0") {
      const ignoredMethods = [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
        "$/cancelRequest"
      ];
      return Boolean(parsed.method && ignoredMethods.includes(parsed.method));
    }
  } catch {
    // No es JSON; asumimos texto libre de conversación real.
  }

  return false;
}

async function saveMessage(params) {
  const validatedParams = SaveMessageSchema.parse(params);
  const { sessionId, project, projectPath, role, content, agentId, relatedMessageId, sourceMessageId, owner } = validatedParams;

  if (isMcpProtocolNoise(content)) {
    console.log(`Skipping MCP protocol message: ${content}`);
    return { success: true, messageId: null };
  }

  if (INVALID_PROJECT.test(project)) {
    const error = new Error(
      `El parámetro 'project' es inválido ("${project}"). Debe ser el nombre del repositorio, no una ruta ni un valor vacío.`
    );
    error.code = "INVALID_PROJECT";
    throw error;
  }

  let messageId = randomUUID();
  let inserted = false;
  const writeOwner = resolveWriteOwner(owner);

  // La validación de proyecto/owner y el INSERT deben ser atómicos respecto de
  // otras escrituras sobre la misma sesión. El advisory lock se toma sobre la
  // misma conexión/transacción que ejecuta estas consultas.
  await withAdvisoryLock(`save-message-session:${writeOwner}:${sessionId}`, async (client) => {
    const existingSessionProject = await client.query(
      `SELECT project FROM conversations WHERE session_id = $1 AND owner = $2 LIMIT 1`,
      [sessionId, writeOwner]
    );
    const existingSession = existingSessionProject.rows[0];

    if (existingSession && existingSession.project !== project) {
      const error = new Error("La sesión no está disponible para este proyecto y usuario.");
      error.code = "SESSION_UNAVAILABLE";
      throw error;
    }

    if (sourceMessageId) {
      const previous = await client.query(
        `SELECT id, role, content, related_message_id FROM conversations
         WHERE owner = $1 AND project = $2 AND session_id = $3 AND source_message_id = $4`,
        [writeOwner, project, sessionId, sourceMessageId]
      );
      const existing = previous.rows[0];
      if (existing) {
        if (existing.role !== role || existing.content !== content ||
            (relatedMessageId && existing.related_message_id && existing.related_message_id !== relatedMessageId)) {
          const error = new Error("sourceMessageId ya identifica otro contenido o vínculo.");
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }
        messageId = existing.id;
        if (relatedMessageId && !existing.related_message_id) {
          await client.query("UPDATE conversations SET related_message_id = $1 WHERE id = $2", [relatedMessageId, messageId]);
        }
        return;
      }
    }

    await client.query(
      `
        INSERT INTO conversations
        (id, session_id, timestamp, project, project_path, role, content, agent_id, related_message_id, owner, source_message_id)
        VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        messageId,
        sessionId,
        project ?? null,
        projectPath ?? null,
        role,
        content,
        agentId ?? null,
        relatedMessageId ?? null,
        writeOwner,
        sourceMessageId ?? null
      ]
    );
    inserted = true;
  });

  const embeddable = isEmbeddingsEnabled() ? prepareForEmbedding(content) : null;
  if (inserted && embeddable) {
    embeddingQueue.addTask({ messageId, content: embeddable, role });
    console.log(`Embedding task for message ${messageId} queued.`);
  }

  return { success: true, messageId };
}

module.exports = saveMessage;
module.exports.saveMessage = saveMessage;
module.exports.SaveMessageSchema = SaveMessageSchema;

