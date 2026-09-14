const express = require("express");
const { applyMiddleware } = require("./middleware");
const { setupMcpRoutes } = require("./routes");
const errorHandler = require("./errorHandler");
const { createMcpServer } = require("./createMcpServer");

console.time("⏱️ App initialization");

const app = express();

// Habilitar la confianza en el proxy para que express-rate-limit
// identifique correctamente la IP del cliente
app.set("trust proxy", 1);

// Middleware para parsear JSON
app.use(express.json());

// Endpoint de health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
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
