const crypto = require("crypto");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");

const transports = new Map();

function setupMcpRoutes(app, server) {
  app.get("/sse", async (req, res) => {
    const clientId = crypto.randomUUID();
    
    const transport = new SSEServerTransport("/messages", res);
    transports.set(clientId, transport);
    
    // cuando el cliente se desconecta, limpiar
    res.on("close", () => {
      transports.delete(clientId);
      console.log(`Cliente ${clientId} desconectado. Transports activos: ${transports.size}`);
    });
    res.setHeader("X-Client-Id", clientId);
    
    await server.connect(transport);
  });
  
  app.post("/messages", async (req, res) => {
    const clientId = req.headers["x-client-id"];
    
    if (!clientId || !transports.has(clientId)) {
      return res.status(400).json({ error: "Cliente no identificado o sesión expirada" });
    }
    
    const transport = transports.get(clientId);
    await transport.handlePostMessage(req, res);
  });
}

module.exports = { setupMcpRoutes };
