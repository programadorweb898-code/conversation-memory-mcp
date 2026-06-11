const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod"); // Although not directly used in app.js, it's used by mcpTools.js, so it's good to keep track
const { applyMiddleware } = require("./middleware");
const { registerMcpTools } = require("./mcpTools");
const { setupMcpRoutes } = require("./routes");
const errorHandler = require("./errorHandler");

const app = express();

// Create server
const server = new McpServer({
  name: "conversation-memory-mcp",
  version: "1.0.0",
});

applyMiddleware(app);
registerMcpTools(server);
setupMcpRoutes(app, server);

// Coloca el middleware de errores después de todas las rutas y middleware para que capture los errores.
app.use(errorHandler);

module.exports = app;
