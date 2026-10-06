const express = require("express");
const { applyMiddleware } = require("./middleware");
const { setupMcpRoutes } = require("./routes");
const { checkDatabase, getHealth } = require("./services/healthCheck");
const errorHandler = require("./errorHandler");
const { createMcpServer } = require("./createMcpServer");
const { getAuth } = require("./context");

console.time("⏱️ App initialization");

const app = express();

// Habilitar la confianza en el proxy para que express-rate-limit
// identifique correctamente la IP del cliente
app.set("trust proxy", 1);

// Middleware para parsear JSON
app.use(express.json());
applyMiddleware(app);

// Health público: un ping único para el balanceador, sin recorrer tablas.
app.get("/health", async (req, res) => {
  try {
    await checkDatabase();
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

// Las métricas son más costosas y requieren autenticación Bearer.
app.get("/health/details", async (req, res) => {
  try {
    const auth = getAuth();
    const owner = auth?.master ? null : auth?.owner;
    res.status(200).json(await getHealth(owner));
  } catch (error) {
    console.error("Health details failed:", error.message);
    res.status(503).json({ status: "degraded", details: "unavailable" });
  }
});

// Create servers for the modern HTTP transport and the legacy SSE transport.
// El /mcp crea un McpServer nuevo por request (stateless); el /sse reutiliza sseServer.
const sseServer = createMcpServer();

setupMcpRoutes(app, { createMcpServer, sseServer });

// Coloca el middleware de errores después de todas las rutas y middleware para que capture los errores.
app.use(errorHandler);

console.timeEnd("⏱️ App initialization");

module.exports = app;
