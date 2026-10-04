#!/usr/bin/env node

const dotenv = require("dotenv");
const logger = require("./logger");

// stdout queda reservado exclusivamente para los mensajes JSON-RPC de MCP.
console.log = logger.log;
console.info = logger.log;
console.warn = logger.error;

const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createMcpServer } = require("./createMcpServer");
const { runMigrations } = require("../scripts/migrate");
const { startWorker, stopWorker } = require("./services/embeddingWorker");
const { db } = require("./database");

dotenv.config();

async function startStdioServer() {
  if (!process.env.DATABASE_URL) {
    console.error("Fatal error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  installShutdownHandlers();

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

let shuttingDown = false;

// Cierra worker y pool y TERMINA el proceso. Antes los handlers solo llamaban a
// stopWorker(): el proceso ignoraba SIGTERM y, al cerrarse stdin, quedaba vivo
// consultando la base (huérfano por cada cliente MCP cerrado).
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(code), 3000);
  forceExit.unref();
  try {
    stopWorker();
    await db.close();
  } catch (error) {
    console.error("Error durante el cierre:", error.message);
  }
  process.exit(code);
}

let handlersInstalled = false;

function installShutdownHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  // El cliente MCP cerró el pipe: no hay nadie con quien hablar.
  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));
}

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

module.exports = { startStdioServer, shutdown, installShutdownHandlers };
