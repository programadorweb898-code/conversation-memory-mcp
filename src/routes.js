const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { saveMessage } = require("./tools/saveMessage"); // Importar herramienta de guardado

const transports = new Map();

function setupMcpRoutes(app, server) {
  app.get("/sse", async (req, res) => {
    console.log("📡 Client connecting to SSE...");
    
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);
    
    console.log("🔗 SSE transport created for session:", sessionId);
    
    // cuando el cliente se desconecta, limpiar
    res.on("close", () => {
      transports.delete(sessionId);
      console.log(`Sesión ${sessionId} desconectada. Transports activos: ${transports.size}`);
    });
    
    console.log("⏳ Connecting MCP server to transport...");
    await server.connect(transport);
    console.log("✅ MCP server connected to transport");
  });
  
  app.post("/messages", async (req, res) => {
    console.log("📥 Recibido POST en /messages");
    
    const sessionId = req.query.sessionId;
    
    if (!sessionId || !transports.has(sessionId)) {
      return res.status(400).json({ error: "Sesión no identificada o expirada" });
    }

    // Persistencia automática (depuración)
    try {
      console.log("🔍 Intentando persistir mensaje...");
      if (req.body) {
        await saveMessage({
          sessionId: sessionId,
          project: "default",
          role: "user",
          content: JSON.stringify(req.body).substring(0, 500)
        });
        console.log("💾 Mensaje persistido automáticamente.");
      }
    } catch (err) {
      console.error("❌ Error persistiendo mensaje:", err);
    }
    
    const transport = transports.get(sessionId);
    await transport.handlePostMessage(req, res, req.body);
  });
}

module.exports = { setupMcpRoutes };
