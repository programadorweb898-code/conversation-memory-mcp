const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const transports = new Map();

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setupMcpRoutes(app, { httpServer, sseServer }) {
  const streamableHttpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  let httpTransportReady;

  app.all("/mcp", async (req, res, next) => {
    try {
      if (!httpTransportReady) {
        httpTransportReady = httpServer.connect(streamableHttpTransport);
      }

      await httpTransportReady;
      await streamableHttpTransport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/sse", async (req, res) => {
    console.log("Client connecting to SSE...");

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId || createSessionId();
    transport.sessionId = sessionId;
    transports.set(sessionId, transport);
    res.setHeader("x-client-id", sessionId);

    console.log("SSE transport created for session:", sessionId);

    // Workaround para un bug conocido del SDK de MCP: el stream SSE se corta
    // solo a los ~5 minutos de inactividad de mensajes reales, aunque la conexión
    // TCP siga abierta. Mandamos un comentario SSE (":ping") cada 2 minutos para
    // mantener el stream activo y evitar que Render lo cuente como inactividad,
    // y evitar que el sessionId se pierda del Map por una reconexión forzada.
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (err) {
        console.error("Error enviando keep-alive SSE:", err.message);
        clearInterval(keepAliveInterval);
      }
    }, 2 * 60 * 1000);

    res.on("close", () => {
      clearInterval(keepAliveInterval);
      transports.delete(sessionId);
      console.log(`Sesion ${sessionId} desconectada. Transports activos: ${transports.size}`);
    });

    console.log("Connecting MCP server to transport...");
    await sseServer.connect(transport);
    console.log("MCP server connected to transport");
  });

  app.post("/messages", async (req, res) => {
    console.log("Recibido POST en /messages");

    const sessionId = req.query.sessionId || req.get("x-client-id");

    if (!sessionId || !transports.has(sessionId)) {
      return res.status(400).json({ error: "Cliente no identificado o sesion expirada" });
    }

    const transport = transports.get(sessionId);

    await transport.handlePostMessage(req, res, req.body);
  });
}

module.exports = { setupMcpRoutes };
