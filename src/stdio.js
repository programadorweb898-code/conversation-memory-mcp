const dotenv = require("dotenv");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createMcpServer } = require("./createMcpServer");
const { runMigrations } = require("../scripts/migrate");
const { startWorker, stopWorker } = require("./services/embeddingWorker");

dotenv.config();

async function startStdioServer() {
  if (!process.env.DATABASE_URL) {
    console.error("Fatal error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  // The npx package owns the schema lifecycle for the user's Neon database.
  // Keep migration logs on stderr because stdout is reserved for MCP messages.
  await runMigrations({
    logger: {
      log: (...args) => console.error(...args),
      error: (...args) => console.error(...args),
    },
  });

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // En modo stdio el worker de embeddings no corría (solo estaba en server.js con
  // ENABLE_EMBEDDING_WORKER=true). Ahora arranca por defecto para que la búsqueda
  // semántica tenga vectores; se desactiva explícitamente con ENABLE_EMBEDDING_WORKER=false.
  if (process.env.ENABLE_EMBEDDING_WORKER !== "false") {
    startWorker();
  }
}

process.on("SIGINT", () => stopWorker());
process.on("SIGTERM", () => stopWorker());

if (require.main === module) {
  startStdioServer().catch((error) => {
    console.error("Failed to start MCP over stdio:", error);
    process.exit(1);
  });
}

module.exports = { startStdioServer };
