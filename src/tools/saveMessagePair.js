const { z } = require("zod");
const saveMessage = require("./saveMessage");

/**
 * Guarda un turno completo (mensaje del usuario + respuesta del asistente) en
 * una sola llamada.
 *
 * El motivo de existir es eliminar el pasamanos de `messageId` que exige la
 * secuencia de dos `saveMessage`: el llamante ya no tiene que conservar el ID
 * del primer mensaje entre dos pasos, que es donde más se pierden turnos.
 *
 * Los `sourceMessageId` son opcionales pero recomendados: si el cliente tiene
 * un ID estable del mensaje, un reintento devuelve el mensaje existente en vez
 * de duplicar el turno.
 */
const SaveMessagePairSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
  projectPath: z.string().optional().nullable(),
  agentId: z.string().optional(),
  userContent: z.string().min(1),
  assistantContent: z.string().min(1),
  userSourceMessageId: z.string().min(1).optional(),
  assistantSourceMessageId: z.string().min(1).optional(),
  owner: z.string().optional(),
});

async function saveMessagePair(params) {
  const validatedParams = SaveMessagePairSchema.parse(params);
  const {
    sessionId,
    project,
    projectPath,
    agentId,
    userContent,
    assistantContent,
    userSourceMessageId,
    assistantSourceMessageId,
    owner,
  } = validatedParams;

  const base = { sessionId, project, projectPath, agentId, owner };

  const user = await saveMessage({
    ...base,
    role: "user",
    content: userContent,
    ...(userSourceMessageId ? { sourceMessageId: userSourceMessageId } : {}),
  });

  // `saveMessage` descarta el ruido de protocolo MCP y devuelve `messageId: null`.
  // En ese caso no hay turno real que vincular: guardar solo la respuesta dejaría
  // un mensaje huérfano sin pregunta.
  if (!user?.messageId) {
    return { success: true, skipped: true, userMessageId: null, assistantMessageId: null };
  }

  let assistant;
  try {
    assistant = await saveMessage({
      ...base,
      role: "assistant",
      content: assistantContent,
      relatedMessageId: user.messageId,
      ...(assistantSourceMessageId ? { sourceMessageId: assistantSourceMessageId } : {}),
    });
  } catch (error) {
    // No se revierte el mensaje del usuario: perder la pregunta es peor que
    // dejar el turno a medio guardar. El error lleva el ID ya persistido para
    // que un reintento con el mismo `userSourceMessageId` complete el par sin
    // duplicarlo.
    const partial = new Error(
      `Se guardó el mensaje del usuario (${user.messageId}) pero falló el del asistente: ${
        error instanceof Error ? error.message : String(error)
      }. Reintentar con el mismo userSourceMessageId completa el turno sin duplicarlo.`
    );
    partial.code = "PAIR_PARTIAL_SAVE";
    partial.userMessageId = user.messageId;
    partial.cause = error;
    throw partial;
  }

  return {
    success: true,
    skipped: false,
    userMessageId: user.messageId,
    assistantMessageId: assistant?.messageId ?? null,
  };
}

module.exports = saveMessagePair;
module.exports.saveMessagePair = saveMessagePair;
module.exports.SaveMessagePairSchema = SaveMessagePairSchema;
