#!/usr/bin/env node

const dotenv = require("dotenv");
const logger = require("./logger");
const { getConfig } = require("./config");

// stdout queda reservado exclusivamente para los mensajes JSON-RPC de MCP.
console.log = logger.log;
console.info = logger.log;
console.warn = logger.error;

const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createMcpServer } = require("./createMcpServer");
const { startWorker, stopWorker } = require("./services/embeddingWorker");
const { db } = require("./database");
const { getDatabaseUrl } = require("./databaseConfig");

dotenv.config();

async function startStdioServer({ processRef = process } = {}) {
  if (!getDatabaseUrl()) {
    console.error("Fatal error: CONVERSATION_MEMORY_DATABASE_URL environment variable is required. Run `conversation-memory-mcp install` first.");
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // En modo stdio el worker de embeddings no corría (solo estaba en server.js con
  // ENABLE_EMBEDDING_WORKER=true). Ahora arranca por defecto para que la búsqueda
  // semántica tenga vectores; se desactiva explícitamente con ENABLE_EMBEDDING_WORKER=false.
  if (getConfig().server.enableEmbeddingWorkerHttp || process.env.ENABLE_EMBEDDING_WORKER !== "false") {
    startWorker();
  }

  let shutdownPromise;
  const shutdown = (exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      try {
        await stopWorker();
      } catch (error) {
        console.error("Error stopping embedding worker:", error.message);
      }

      try {
        await server.close();
      } catch (error) {
        console.error("Error closing MCP server:", error.message);
      }

      try {
        await db.close();
      } catch (error) {
        console.error("Error closing database pool:", error.message);
        if (exitCode === 0) exitCode = 1;
      }

      processRef.exit(exitCode);
    })();

    return shutdownPromise;
  };

  processRef.stdin.once("end", () => { void shutdown(0); });
  processRef.stdin.once("close", () => { void shutdown(0); });
  processRef.once("SIGINT", () => { void shutdown(130); });
  processRef.once("SIGTERM", () => { void shutdown(143); });

  return { server, transport, shutdown };
}

process.on("SIGINT", () => stopWorker());
process.on("SIGTERM", () => stopWorker());

// Un rechazo suelto no debe derribar el servidor: se registra en stderr, que es
// el único stream permitido para esto, y se sigue sirviendo.
process.on("unhandledRejection", (reason) => {
  console.error("Promesa rechazada sin manejar:", reason);
});

if (require.main === module) {
  startStdioServer().catch((error) => {
    console.error("Failed to start MCP over stdio:", error);
    process.exit(1);
  });
}

module.exports = { startStdioServer };
