const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { registerMcpTools } = require("./mcpTools");
const { version } = require("../package.json");

function createMcpServer(options = {}) {
  const server = new McpServer({
    name: "conversation-memory-mcp",
    version,
  });

  registerMcpTools(server, options);
  return server;
}

module.exports = { createMcpServer };
