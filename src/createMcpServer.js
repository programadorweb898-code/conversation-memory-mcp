const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { registerMcpTools } = require("./mcpTools");

function createMcpServer(options = {}) {
  const server = new McpServer({
    name: "conversation-memory-mcp",
    version: "1.0.0",
  });

  registerMcpTools(server, options);
  return server;
}

module.exports = { createMcpServer };
