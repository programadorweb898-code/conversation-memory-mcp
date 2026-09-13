const dotenv = require("dotenv");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createMcpServer } = require("./createMcpServer");
const { runMigrations } = require("../scripts/migrate");

dotenv.config();

async function startStdioServer() {
  if (!process.env.DATABASE_URL) {
    console.error("Fatal error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  // The npx package owns the schema lifecycle for the user's Neon database.
  // Migrations are idempotent and protected by a PostgreSQL advisory lock.
  await runMigrations();

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

if (require.main === module) {
  startStdioServer().catch((error) => {
    console.error("Failed to start MCP over stdio:", error);
    process.exit(1);
  });
}

module.exports = { startStdioServer };
