const { z } = require("zod");
const { db } = require("./database");

// Import tools
const { saveMessage } = require("./tools/saveMessage");
const { generateEmbedding, saveEmbedding } = require("./services/embeddingService");
const searchMessages = require("./tools/searchMessages");
const semanticSearchMessages = require("./tools/semanticSearchMessages");
const searchSessionsBySummary = require("./tools/searchSessionsBySummary");
const lastSession = require("./tools/lastSession");
const recoverSession = require("./tools/recoverSession");
const listSessions = require("./tools/listSessions");
const pushToEngram = require("./tools/pushToEngram");
const getLastSessionContext = require("./tools/getLastSessionContext");
const saveSessionSummary = require("./tools/saveSessionSummary"); 
const getSessionSummary = require("./tools/getSessionSummary"); 
const finalizeSession = require("./tools/finalizeSession");
const deleteMessage = require("./tools/deleteMessage");
const deleteSession = require("./tools/deleteSession");
const deleteMessagePair = require("./tools/deleteMessagePair");

function registerMcpTools(server) {
  console.time("⏱️ Registering MCP tools");
  // 1. saveMessage
  server.tool(
  "saveMessage",           // nombre de la tool
  `Guarda un mensaje en la memoria persistente de conversaciones.
REGLA PROACTIVA: Llamá a saveMessage inmediatamente después de cualquier turno de conversación relevante — sin esperar a que el usuario te lo pida.
Guardá siempre en pares: primero el mensaje del usuario (role: "user"), anotando el messageId que devuelve esta tool en la respuesta; después guardá tu respuesta (role: "assistant") pasando ese mismo ID como relatedMessageId.
Usá el mismo sessionId durante toda la sesión activa.
Identificate pasando tu propio nombre en agentId en cada llamada (por ejemplo 'gemini-cli', 'github-copilot-cli'), para que la memoria pueda filtrarse por agente más adelante.
No guardés saludos, confirmaciones cortas ("ok", "entendido"), ni mensajes sin contenido sustancioso. Guardá cuando haya una pregunta real, una decisión, un análisis, o cualquier intercambio que sea valioso recuperar en el futuro.`,              // descripción (esto es lo que ve el agente)
  {
    sessionId: z.string().describe("ID de la sesión"),
    project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    role: z.string().describe("Rol del emisor (user/assistant)"),
    content: z.string().describe("Contenido del mensaje"),
    agentId: z.string().optional().describe("Identificador único del agente que genera el mensaje"),
    relatedMessageId: z.string().optional().describe("ID del mensaje relacionado (pregunta/respuesta)"),
  },
  async ({ sessionId, project, role, content, agentId, relatedMessageId }) => {
    const result = await saveMessage({ sessionId, project, role, content, agentId, relatedMessageId });
    const text = result?.messageId
      ? `Mensaje guardado correctamente. ID: ${result.messageId}`
      : "Mensaje guardado correctamente.";
    return { content: [{ type: "text", text }] };
  }
);

  // 2. searchMessages
  server.tool(
    "searchMessages",
    "Busca mensajes en el historial",
    {
      searchTerm: z.string().describe("Término de búsqueda (palabra clave o consulta semántica)"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
    },
    async ({ searchTerm, project, agentId }) => {
      const results = await searchMessages({ searchTerm, project, agentId });
      return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }], structuredContent: { "data": results } };
    }
  );

  // 2.5. semanticSearchMessages
  server.tool(
    "semanticSearchMessages",
    "Busca mensajes semánticamente similares a una consulta",
    {
      query: z.string().describe("La consulta de búsqueda"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
      limit: z.number().optional().describe("Número máximo de resultados (por defecto: 5)"),
    },
    async ({ query, project, agentId, limit }) => {
      const results = await semanticSearchMessages({ query, project, agentId, limit });
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
      const history = await searchSessionsBySummary({ query, project });
      return { content: [{ type: "text", text: JSON.stringify({ history }, null, 2) }], structuredContent: { history } };
    }
  );

  // 3. lastSession
  server.tool(
    "lastSession",
    "Recupera el ID de la última sesión",
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
    },
    async ({ project, agentId }) => {
      const sessionId = await lastSession({ project, agentId });
      return { content: [{ type: "text", text: sessionId || "No hay sesiones previas." }] };
    }
  );

  // 4. recoverSession
  server.tool(
    "recoverSession",
    "Recupera todos los mensajes de una sesión",
    {
      sessionId: z.string().describe("ID de la sesión a recuperar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
    },
    async ({ sessionId, project, agentId }) => {
      const messages = await recoverSession({ sessionId, project, agentId });
      return { content: [{ type: "text", text: JSON.stringify({ messages }, null, 2) }], structuredContent: { messages } };
    }
  );

  // 5. listSessions
  server.tool(
    "listSessions",
    "Lista todas las sesiones disponibles",
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
    },
    async ({ project, agentId }) => {
      const sessions = await listSessions({ project, agentId });
      return { content: [{ type: "text", text: JSON.stringify({ data: sessions }, null, 2) }] };
    }
  );

  // 6. pushToEngram
  server.tool(
    "pushToEngram",
    "Prepara un mensaje para ser enviado a Engram",
    {
      messageId: z.string().describe("ID del mensaje a recuperar"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
    },
    async ({ messageId, project }) => {
      const message = await pushToEngram({ messageId, project });
      return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
    }
  );

  // 7. getLastSessionContext
  server.tool(
    "getLastSessionContext",
    "Recupera el historial completo de la última sesión",
    {
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      agentId: z.string().optional().describe("Filtrar por ID de agente"),
    },
    async ({ project, agentId }) => {
      const context = await getLastSessionContext({ project, agentId });
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
      await saveSessionSummary({ sessionId, project, summary });
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
      const summary = await getSessionSummary({ sessionId, project });
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
      const result = await finalizeSession({ sessionId, project });
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
      await deleteSession({ sessionId, project });
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
      await deleteMessage({ messageId, project });
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
      await deleteMessagePair({ messageId, project });
      return { content: [{ type: "text", text: `Par de mensajes con ${messageId} y sus embeddings eliminados correctamente.` }] };
    }
  );

  // 11. generateAndSaveEmbedding
  server.tool(
    "generateAndSaveEmbedding",
    "Genera y guarda un embedding para un mensaje dado",
    {
      messageId: z.string().describe("ID del mensaje al que se asociará el embedding"),
      project: z.string().describe("Nombre del proyecto (OBLIGATORIO para aislar los datos por proyecto)"),
      text: z.string().describe("El texto del cual generar el embedding"),
      role: z.string().describe("Rol del emisor (user/assistant)"),
    },
    async ({ messageId, project, text, role }) => {
      try {
        const message = await db.getAsync(
          `SELECT id FROM conversations WHERE id = $1 AND project = $2`,
          [messageId, project]
        );
        if (!message) throw new Error("Mensaje no encontrado en el proyecto especificado");
        const generatedEmbedding = await generateEmbedding({ role, content: text });
        await saveEmbedding(messageId, generatedEmbedding);
        return { content: [{ type: "text", text: `Embedding generado y guardado para el mensaje ${messageId}.` }] };
      } catch (error) {
        console.error("Error al generar y guardar embedding:", error);
        return { content: [{ type: "text", text: `Error al generar y guardar embedding para el mensaje ${messageId}: ${error.message}` }] };
      }
    }
  );
  
  console.timeEnd("⏱️ Registering MCP tools");
}

module.exports = { registerMcpTools };
