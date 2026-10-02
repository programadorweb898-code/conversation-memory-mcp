const express = require("express");
const { applyMiddleware } = require("./middleware");
const { setupMcpRoutes } = require("./routes");
const { getHealth } = require("./services/healthCheck");
const errorHandler = require("./errorHandler");
const { createMcpServer } = require("./createMcpServer");

console.time("⏱️ App initialization");

const app = express();

// Habilitar la confianza en el proxy para que express-rate-limit
// identifique correctamente la IP del cliente
app.set("trust proxy", 1);

// Middleware para parsear JSON
app.use(express.json());

// Endpoint de health check. Es público (ver requireBearerToken), por lo que
// devuelve solo agregados: nunca nombres de proyecto ni de owner.
app.get("/health", async (req, res) => {
  try {
    res.status(200).json(await getHealth());
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(200).json({ status: "degraded", database: "unreachable" });
  }
});

// Create servers for the modern HTTP transport and the legacy SSE transport.
// El /mcp crea un McpServer nuevo por request (stateless); el /sse reutiliza sseServer.
const sseServer = createMcpServer();

applyMiddleware(app);
setupMcpRoutes(app, { createMcpServer, sseServer });

// Coloca el middleware de errores después de todas las rutas y middleware para que capture los errores.
app.use(errorHandler);

console.timeEnd("⏱️ App initialization");

module.exports = app;
