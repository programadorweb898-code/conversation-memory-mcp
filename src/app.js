const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod"); // Although not directly used in app.js, it's used by mcpTools.js, so it's good to keep track
const { applyMiddleware } = require("./middleware");
const { registerMcpTools } = require("./mcpTools");
const { setupMcpRoutes } = require("./routes");
const errorHandler = require("./errorHandler");

console.time("⏱️ App initialization");

const app = express();

// Habilitar la confianza en el proxy para entornos como Render
// Esto es necesario para que express-rate-limit identifique correctamente la IP del cliente
app.set("trust proxy", 1);

// Middleware para parsear JSON
app.use(express.json());

// Endpoint de health check para Render
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

function createMcpServer() {
  const server = new McpServer({
    name: "conversation-memory-mcp",
    version: "1.0.0",
  });

  registerMcpTools(server);
  return server;
}

// Create servers for the modern HTTP transport and the legacy SSE transport.
const httpServer = createMcpServer();
const sseServer = createMcpServer();

applyMiddleware(app);
setupMcpRoutes(app, { httpServer, sseServer });

// Coloca el middleware de errores después de todas las rutas y middleware para que capture los errores.
app.use(errorHandler);

console.timeEnd("⏱️ App initialization");

module.exports = app;
