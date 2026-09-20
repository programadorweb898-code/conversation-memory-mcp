const { z } = require("zod");
const { getAuth } = require("./context");
const logger = require("./logger");

// Import tools
const { saveMessage } = require("./tools/saveMessage");
const searchMessages = require("./tools/searchMessages");
const semanticSearchMessages = require("./tools/semanticSearchMessages");
const searchSessionsBySummary = require("./tools/searchSessionsBySummary");
const lastSession = require("./tools/lastSession");
const recoverSession = require("./tools/recoverSession");
const listSessions = require("./tools/listSessions");
const getLastSessionContext = require("./tools/getLastSessionContext");
const saveSessionSummary = require("./tools/saveSessionSummary"); 
const getSessionSummary = require("./tools/getSessionSummary"); 
const finalizeSession = require("./tools/finalizeSession");
const deleteMessage = require("./tools/deleteMessage");
const deleteSession = require("./tools/deleteSession");
const deleteMessagePair = require("./tools/deleteMessagePair");

/**
 * Agrega el `owner` autenticado a los parámetros de una tool. El owner proviene
 * del contexto HTTP (token), NUNCA de los parámetros públicos del request.
 * Si el llamante es admin (token master, owner null), no se filtra por owner.
 * @param {object} params - Parámetros de la tool.
 * @returns {object}
 */
function withScope(params) {
  const auth = getAuth();
  const owner = auth && auth.owner;
  return owner ? { ...params, owner } : params;
}

function registerMcpTools(server) {
  const registrationStartedAt = Date.now();
  // 1. saveMessage
  server.tool(
  "saveMessage",           // nombre de la tool
  `Guarda un mensaje de conversación real en Neon.
Esta tool NO debe usarse para mensajes de protocolo MCP ni para eventos de infraestructura. Solo persiste turnos reales de usuario o asistente, con contenido útil para el historial del proyecto.
Cuando seas un agente usando este MCP, guardá primero el mensaje del usuario (role: "user") anotando el messageId que devuelve esta tool; después guardá tu respuesta (role: "assistant") pasando ese mismo ID como relatedMessageId.
Usá el mismo sessionId durante toda la sesión activa e identificá tu agente con agentId (por ejemplo 'claude-desktop', 'copilot', 'gemini-cli'), para que la memoria pueda filtrarse por agente más adelante. El parámetro project es obligatorio y aísla los datos.
En clientes que ya integran guardado automático, esta tool puede duplicar mensajes; en ese caso usala solo para backfill.
Esta tool debe usarse únicamente para conservar el historial real de conversaciones; no persiste eventos de protocolo MCP ni infraestructura.`,              // descripción (esto es lo que ve el agente)
  {
    sessionId: z.string().describe("ID de la sesión"),
    project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    role: z.string().describe("Rol del emisor (user/assistant)"),
    content: z.string().describe("Contenido del mensaje"),
    agentId: z.string().optional().describe("Identificador único del agente que genera el mensaje"),
    relatedMessageId: z.string().optional().describe("ID del mensaje relacionado (pregunta/respuesta)"),
  },
  async ({ sessionId, project, role, content, agentId, relatedMessageId }) => {
    const result = await saveMessage(withScope({ sessionId, project, role, content, agentId, relatedMessageId }));
    const text = result?.messageId
      ? `Mensaje guardado correctamente. ID: ${result.messageId}`
      : "Mensaje guardado correctamente.";
    return { content: [{ type: "text", text }] };
  }
);

  // 2. searchMessages
  server.tool(
    "searchMessages",
    `Busca mensajes en el historial.
Búsqueda híbrida: usa similitud semántica (pgvector) cuando hay embeddings y cae a coincidencia léxica (ILIKE) si no los hay, así el conocimiento siempre es recuperable.
ACCESO MULTI-AGENTE: el conocimiento es compartido y remoto (Neon). Si NO pasás agentId, buscás en TODO lo que guardaron todos los agentes; pasándolo, acotás a un agente.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente filtrar por agente (p. ej. "la última charla con copilot"). Un agentId no pedido puede devolver vacío aunque existan mensajes de otros agentes.
Cada resultado incluye agent_id: identifica quién escribió ese mensaje (turno, plan o acción).`,
    {
      searchTerm: z.string().describe("Término de búsqueda (palabra clave o consulta semántica)"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
    },
async ({ searchTerm, project, agentId }) => {
    const results = await searchMessages(withScope({ searchTerm, project, agentId }));
      return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }], structuredContent: { "data": results } };
    }
  );

  // 2.5. semanticSearchMessages
  server.tool(
    "semanticSearchMessages",
    `Busca mensajes semánticamente similares a una consulta.
ACCESO MULTI-AGENTE: el conocimiento es compartido y remoto (Neon). Si NO pasás agentId, buscás en TODO lo que guardaron todos los agentes; pasándolo, acotás a un agente.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente filtrar por agente (p. ej. "la última charla con copilot"). Un agentId no pedido puede devolver vacío aunque existan mensajes de otros agentes.
Cada resultado incluye agent_id: identifica quién escribió ese mensaje (turno, plan o acción).
Si no hay embeddings indexados, responde con coincidencia léxica (ILIKE).`,
    {
      query: z.string().describe("La consulta de búsqueda"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
      limit: z.number().optional().describe("Número máximo de resultados (por defecto: 5)"),
    },
async ({ query, project, agentId, limit }) => {
    const results = await semanticSearchMessages(withScope({ query, project, agentId, limit }));
      return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }], structuredContent: { "data": results } };
    }
  );

  // 2.6. searchSessionsBySummary
  server.tool(
    "searchSessionsBySummary",
    "Busca sesiones relevantes mediante su resumen semántico y recupera todo su historial",
    {
      query: z.string().describe("La consulta de búsqueda"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ query, project }) => {
      const history = await searchSessionsBySummary(withScope({ query, project }));
      return { content: [{ type: "text", text: JSON.stringify({ history }, null, 2) }], structuredContent: { history } };
    }
  );

  // 3. lastSession
  server.tool(
    "lastSession",
    `Recupera el ID de la última sesión del proyecto.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente la última sesión de un agente. Sin agentId devuelve la última sesión de cualquier agente.`,
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
    },
    async ({ project, agentId }) => {
      const sessionId = await lastSession(withScope({ project, agentId }));
      return { content: [{ type: "text", text: sessionId || "No hay sesiones previas." }] };
    }
  );

  // 4. recoverSession
  server.tool(
    "recoverSession",
    `Recupera todos los mensajes de una sesión, ordenados cronológicamente.
Cada mensaje incluye agent_id para saber qué agente lo escribió (turno, plan o acción).
Sin agentId devuelve los mensajes de todos los agentes de la sesión.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente filtrar por agente (p. ej. "la última charla con copilot"). Un agentId no pedido puede devolver vacío aunque la sesión tenga mensajes de otros agentes.`,
    {
      sessionId: z.string().describe("ID de la sesión a recuperar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
    },
    async ({ sessionId, project, agentId }) => {
      const messages = await recoverSession(withScope({ sessionId, project, agentId }));
      return { content: [{ type: "text", text: JSON.stringify({ messages }, null, 2) }], structuredContent: { messages } };
    }
  );

  // 5. listSessions
  server.tool(
    "listSessions",
    `Lista todas las sesiones disponibles del proyecto.
ACCESO MULTI-AGENTE: si NO pasás agentId, listás sesiones de todos los agentes; pasándolo, solo las de ese agente.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente filtrar por agente. Un agentId no pedido puede devolver vacío aunque existan sesiones de otros agentes.`,
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
    },
    async ({ project, agentId }) => {
      const sessions = await listSessions(withScope({ project, agentId }));
      return { content: [{ type: "text", text: JSON.stringify({ data: sessions }, null, 2) }] };
    }
  );

  // 7. getLastSessionContext
  server.tool(
    "getLastSessionContext",
    `Recupera el historial completo de la última sesión.
Cada mensaje incluye agent_id para saber qué agente lo escribió.
Sin agentId, la última sesión puede ser de cualquier agente; pasándolo, la última de ese agente.
REGLA: NO uses agentId en lecturas base. Usalo solo si el usuario pide explícitamente filtrar por agente. Un agentId no pedido puede devolver vacío aunque exista historia de otros agentes.`,
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente (SOLO si el usuario lo pidió explícitamente; no lo uses en lecturas base)"),
    },
    async ({ project, agentId }) => {
      const context = await getLastSessionContext(withScope({ project, agentId }));
      return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
    }
  );

  // 8. saveSessionSummary
  server.tool(
    "saveSessionSummary",
    "Guarda o actualiza el resumen de una sesión",
    {
      sessionId: z.string().describe("ID de la sesión"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      summary: z.string().describe("Contenido del resumen"),
    },
    async ({ sessionId, project, summary }) => {
      await saveSessionSummary(withScope({ sessionId, project, summary }));
      return { content: [{ type: "text", text: "Resumen guardado correctamente." }] };
    }
  );

  // 9. getSessionSummary
  server.tool(
    "getSessionSummary",
    "Recupera el resumen de una sesión específica",
    {
      sessionId: z.string().describe("ID de la sesión"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ sessionId, project }) => {
      const summary = await getSessionSummary(withScope({ sessionId, project }));
      return {
        content: [
          {
            type: "text",
            text: summary ? JSON.stringify(summary, null, 2) : "No hay resumen para esta sesión.",
          },
        ],
      };
    }
  );

  // 10. finalizeSession
  server.tool(
    "finalizeSession",
    "Finaliza explícitamente una sesión, generando y guardando su resumen",
    {
      sessionId: z.string().describe("ID de la sesión"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ sessionId, project }) => {
      const result = await finalizeSession(withScope({ sessionId, project }));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // 11. deleteSession
  server.tool(
    "deleteSession",
    "Elimina todos los mensajes, embeddings y el resumen de una sesión específica",
    {
      sessionId: z.string().describe("ID de la sesión a eliminar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ sessionId, project }) => {
      await deleteSession(withScope({ sessionId, project }));
      return { content: [{ type: "text", text: `Sesión ${sessionId}, sus mensajes y resumen eliminados correctamente.` }] };
    }
  );

  // 12. deleteMessage
  server.tool(
    "deleteMessage",
    "Elimina un mensaje específico y su embedding asociado",
    {
      messageId: z.string().describe("ID del mensaje a eliminar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ messageId, project }) => {
      await deleteMessage(withScope({ messageId, project }));
      return { content: [{ type: "text", text: `Mensaje ${messageId} y su embedding eliminados correctamente.` }] };
    }
  );

  // 13. deleteMessagePair
  server.tool(
    "deleteMessagePair",
    "Elimina un mensaje y su mensaje relacionado (pregunta/respuesta) y sus embeddings",
    {
      messageId: z.string().describe("ID del mensaje del par a eliminar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ messageId, project }) => {
      await deleteMessagePair(withScope({ messageId, project }));
      return { content: [{ type: "text", text: `Par de mensajes con ${messageId} y sus embeddings eliminados correctamente.` }] };
    }
  );

  logger.log(`⏱️ Registering MCP tools: ${Date.now() - registrationStartedAt}ms`);
}

module.exports = { registerMcpTools, withScope };
