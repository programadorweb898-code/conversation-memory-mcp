const sseSdk = require("@modelcontextprotocol/sdk/server/sse.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const transports = new Map();

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function closeMcpRoutes() {
  const sessions = Array.from(transports.values());
  await Promise.allSettled(
    sessions.map(async ({ transport }) => {
      try {
        await transport.close();
      } catch (error) {
        console.error("Error closing MCP SSE transport:", error.message);
      }
    }),
  );
}

function setupMcpRoutes(app, { createMcpServer }) {
  app.all("/mcp", async (req, res, next) => {
    // Modo stateless: el SDK de MCP no permite reutilizar un StreamableHTTPServerTransport
    // sin sessionIdGenerator ("Stateless transport cannot be reused across requests") y un
    // McpServer solo admite un transporte a la vez. Siguiendo el ejemplo oficial del SDK,
    // se crea un server y un transporte nuevos por request y se cierran al terminar.
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/sse", async (req, res) => {
    console.log("Client connecting to SSE...");

    const transport = new sseSdk.SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId || createSessionId();
    transport.sessionId = sessionId;
    const server = createMcpServer();

    transports.set(sessionId, {
      transport,
      apiKeyId: req.auth?.apiKeyId ?? null,
      master: Boolean(req.auth?.master),
    });
    res.setHeader("x-client-id", sessionId);

    console.log("SSE transport created for session:", sessionId);

    // Workaround para un bug conocido del SDK de MCP: el stream SSE se corta
    // solo a los ~5 minutos de inactividad de mensajes reales, aunque la conexión
    // TCP siga abierta. Mandamos un comentario SSE (":ping") cada 2 minutos para
    // mantener el stream activo y evitar que el sessionId se pierda del Map por
    // una reconexión forzada.
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (err) {
        console.error("Error enviando keep-alive SSE:", err.message);
        clearInterval(keepAliveInterval);
      }
    }, 2 * 60 * 1000);

    let sessionClosed = false;
    const closeSession = () => {
      if (sessionClosed) return;
      sessionClosed = true;
      clearInterval(keepAliveInterval);
      transports.delete(sessionId);
      void server.close();
      console.log(`Sesion ${sessionId} desconectada. Transports activos: ${transports.size}`);
    };

    // Dependiendo de cómo se cierre el cliente, Node puede emitir "close" en
    // el request o en la response. Escuchamos ambos y hacemos el cleanup una
    // sola vez para que la sesión no quede viva ni se cierre dos veces.
    req.on("close", closeSession);
    res.on("close", closeSession);

    console.log("Connecting MCP server to transport...");
    await server.connect(transport);
    console.log("MCP server connected to transport");
  });

  app.post("/messages", async (req, res) => {
    console.log("Recibido POST en /messages");

    const sessionId = req.query.sessionId || req.get("x-client-id");

    if (!sessionId || !transports.has(sessionId)) {
      return res.status(400).json({ error: "Cliente no identificado o sesion expirada" });
    }

    const transportSession = transports.get(sessionId);
    const auth = req.auth || {};
    const sameCredential = transportSession.master
      ? auth.master === true
      : auth.master !== true && auth.apiKeyId === transportSession.apiKeyId;

    if (!sameCredential) {
      return res.status(403).json({ error: "Sesión MCP no disponible para estas credenciales." });
    }

    await transportSession.transport.handlePostMessage(req, res, req.body);
  });
  return { close: closeMcpRoutes };
}

module.exports = { setupMcpRoutes, closeMcpRoutes };
