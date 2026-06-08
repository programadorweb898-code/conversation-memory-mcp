const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");

// Import tools
const saveMessage = require("./tools/saveMessage");
const searchMessages = require("./tools/searchMessages");
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

// Seguimiento de inactividad
const activityTracker = new Map();
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutos

function updateActivity(sessionId) {
  // Limpiar temporizador anterior si existe
  if (activityTracker.has(sessionId)) {
    clearTimeout(activityTracker.get(sessionId).timer);
  }

  // Crear nuevo temporizador
  const timer = setTimeout(async () => {
    console.log(`Inactividad detectada para la sesión: ${sessionId}`);
    try {
      await finalizeSession(sessionId);
    } catch (err) {
      console.error(`Error al finalizar sesión por inactividad ${sessionId}:`, err);
    }
    activityTracker.delete(sessionId);
  }, INACTIVITY_TIMEOUT);

  activityTracker.set(sessionId, { timer });
}

// Changed import for embeddingService
const { generateEmbedding, saveEmbedding, initializeEmbeddingPipeline } = require("./services/embeddingService");

// Create server
const server = new McpServer({
  name: "conversation-memory-mcp",
  version: "1.0.0",
});

// Register tools

// 1. saveMessage
server.tool(
  "saveMessage",
  "Guarda un mensaje en la memoria de conversaciones",
  {
    sessionId: z.string().describe("ID de la sesión"),
    project: z.string().optional().describe("Nombre del proyecto"),
    role: z.string().describe("Rol del emisor (user/assistant)"),
    content: z.string().describe("Contenido del mensaje"),
  },
  async ({ sessionId, project, role, content }) => {
    await saveMessage({ sessionId, project, role, content });
    return { content: [{ type: "text", text: "Mensaje guardado correctamente." }] };
  }
);

// 2. searchMessages
server.tool(
  "searchMessages",
  "Busca mensajes en el historial",
  {
    query: z.string().describe("Término de búsqueda"),
    project: z.string().optional().describe("Filtrar por proyecto"),
  },
  async ({ query, project }) => {
    const results = await searchMessages({ query, project });
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// 3. lastSession
server.tool(
  "lastSession",
  "Recupera el ID de la última sesión",
  {},
  async () => {
    const sessionId = await lastSession();
    return { content: [{ type: "text", text: sessionId || "No hay sesiones previas." }] };
  }
);

// 4. recoverSession
server.tool(
  "recoverSession",
  "Recupera todos los mensajes de una sesión",
  {
    sessionId: z.string().describe("ID de la sesión a recuperar"),
  },
  async ({ sessionId }) => {
    const messages = await recoverSession({ sessionId });
    return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
  }
);

// 5. listSessions
server.tool(
  "listSessions",
  "Lista todas las sesiones disponibles",
  {},
  async () => {
    const sessions = await listSessions();
    return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
  }
);

// 6. pushToEngram
server.tool(
  "pushToEngram",
  "Prepara un mensaje para ser enviado a Engram",
  {
    messageId: z.string().describe("ID del mensaje a recuperar"),
  },
  async ({ messageId }) => {
    const message = await pushToEngram({ messageId });
    return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
  }
);

// 7. getLastSessionContext
server.tool(
  "getLastSessionContext",
  "Recupera el historial completo de la última sesión",
  {},
  async () => {
    const context = await getLastSessionContext();
    return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
  }
);

// 8. saveSessionSummary
server.tool(
  "saveSessionSummary",
  "Guarda o actualiza el resumen de una sesión",
  {
    sessionId: z.string().describe("ID de la sesión"),
    summary: z.string().describe("Contenido del resumen"),
  },
  async ({ sessionId, summary }) => {
    await saveSessionSummary({ sessionId, summary });
    return { content: [{ type: "text", text: "Resumen guardado correctamente." }] };
  }
);

// 9. getSessionSummary
server.tool(
  "getSessionSummary",
  "Recupera el resumen de una sesión específica",
  {
    sessionId: z.string().describe("ID de la sesión"),
  },
  async ({ sessionId }) => {
    const summary = await getSessionSummary({ sessionId });
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
  },
  async ({ sessionId }) => {
    const summary = await finalizeSession(sessionId);
    return { content: [{ type: "text", text: `Sesión finalizada. Resumen: ${summary}` }] };
  }
);

// 11. deleteSession
server.tool(
  "deleteSession",
  "Elimina todos los mensajes y embeddings de una sesión específica",
  {
    sessionId: z.string().describe("ID de la sesión a eliminar"),
  },
  async ({ sessionId }) => {
    await deleteSession(sessionId);
    return { content: [{ type: "text", text: `Sesión ${sessionId} y sus mensajes eliminados correctamente.` }] };
  }
);

// 11. generateAndSaveEmbedding
server.tool(
  "generateAndSaveEmbedding",
  "Genera y guarda un embedding para un mensaje dado",
  {
    messageId: z.string().describe("ID del mensaje al que se asociará el embedding"),
    text: z.string().describe("El texto del cual generar el embedding"),
  },
  async ({ messageId, text }) => {
    try {
      const generatedEmbedding = await generateEmbedding(text);
      await saveEmbedding(messageId, generatedEmbedding);
      return { content: [{ type: "text", text: `Embedding generado y guardado para el mensaje ${messageId}.` }] };
    } catch (error) {
      console.error("Error al generar y guardar embedding:", error);
      return { content: [{ type: "text", text: `Error al generar y guardar embedding para el mensaje ${messageId}: ${error.message}` }] };
    }
  }
);


const app = express();
let transport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

// Initialize the embedding pipeline before starting the server
async function startServer() {
  await initializeEmbeddingPipeline();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
