const crypto = require("crypto");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { saveMessage } = require("./tools/saveMessage"); // Importar herramienta de guardado

const transports = new Map();

function setupMcpRoutes(app, server) {
  app.get("/sse", async (req, res) => {
    console.log("📡 Client connecting to SSE...");
    const clientId = crypto.randomUUID();
    
    const transport = new SSEServerTransport("/messages", res);
    transports.set(clientId, transport);
    
    console.log("🔗 SSE transport created for client:", clientId);
    
    // cuando el cliente se desconecta, limpiar
    res.on("close", () => {
      transports.delete(clientId);
      console.log(`Cliente ${clientId} desconectado. Transports activos: ${transports.size}`);
    });
    res.setHeader("X-Client-Id", clientId);
    
    console.log("⏳ Connecting MCP server to transport...");
    await server.connect(transport);
    console.log("✅ MCP server connected to transport");
  });
  
  app.post("/messages", async (req, res) => {
    console.log("📥 Recibido POST en /messages");
    console.log("📥 Body completo:", JSON.stringify(req.body));
    
    const clientId = req.headers["x-client-id"];
    
    if (!clientId || !transports.has(clientId)) {
      return res.status(400).json({ error: "Cliente no identificado o sesión expirada" });
    }

    // Persistencia automática (depuración)
    try {
      console.log("🔍 Intentando persistir mensaje...");
      // Registramos qué estamos viendo para ajustar el IF
      if (req.body) {
        console.log("🔍 Estructura del body:", Object.keys(req.body));
        
        // Intentamos guardar algo genérico para ver si funciona
        await saveMessage({
          sessionId: clientId,
          project: "default",
          role: "user",
          content: JSON.stringify(req.body).substring(0, 500) // Guardamos parte del body
        });
        console.log("💾 Mensaje persistido automáticamente (depuración).");
      }
    } catch (err) {
      console.error("❌ Error persistiendo mensaje:", err);
    }
    
    const transport = transports.get(clientId);
    await transport.handlePostMessage(req, res);
  });
}

module.exports = { setupMcpRoutes };
