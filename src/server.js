const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Import tools
const saveMessage = require("./tools/saveMessage");
const searchMessages = require("./tools/searchMessages");
const lastSession = require("./tools/lastSession");
const recoverSession = require("./tools/recoverSession");
const listSessions = require("./tools/listSessions");

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

// Connect
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch(console.error);
