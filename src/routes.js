const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { saveMessage } = require("./tools/saveMessage");

const transports = new Map();

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requireBearerToken(req, res, next) {
  const expectedToken = process.env.MCP_BEARER_TOKEN;

  if (!expectedToken) {
    return next();
  }

  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (token !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

function setupMcpRoutes(app, { httpServer, sseServer }) {
  const streamableHttpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  let httpTransportReady;

  app.all("/mcp", requireBearerToken, async (req, res, next) => {
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

    res.on("close", () => {
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

    try {
      console.log("Intentando persistir mensaje...");
      if (req.body) {
        await saveMessage({
          sessionId,
          project: "default",
          role: "user",
          content: JSON.stringify(req.body).substring(0, 500),
        });
        console.log("Mensaje persistido automaticamente.");
      }
    } catch (err) {
      console.error("Error persistiendo mensaje:", err);
    }

    const transport = transports.get(sessionId);

    if (typeof transport.send === "function" && !transport.__conversationMemoryWrapped) {
      const originalSend = transport.send.bind(transport);
      transport.send = async (message) => {
        if (message.method === "notifications/message" || (message.result && message.result.content)) {
          try {
            const content = JSON.stringify(message.result || message.params).substring(0, 1000);
            await saveMessage({
              sessionId,
              project: "default",
              role: "assistant",
              content,
            });
            console.log("Respuesta del asistente persistida automaticamente.");
          } catch (err) {
            console.error("Error persistiendo respuesta del asistente:", err);
          }
        }
        return originalSend(message);
      };
      transport.__conversationMemoryWrapped = true;
    }

    await transport.handlePostMessage(req, res, req.body);
  });
}

module.exports = { setupMcpRoutes };
