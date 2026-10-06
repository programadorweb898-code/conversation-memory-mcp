const { startWorker, stopWorker } = require("./services/embeddingWorker");
const { getConfig } = require("./config");
const app = require("./app");
let httpServer;

function shouldStartEmbeddingWorker() {
  return getConfig().server.enableEmbeddingWorkerHttp;
}

async function startServer() {
  console.time("Startup total");

  if (!getConfig().server.bearerToken) {
    console.error("Fatal error: MCP_BEARER_TOKEN environment variable is required.");
    process.exit(1);
  }

  const PORT = getConfig().server.port;

  console.time("Listening on port");
  httpServer = app.listen(PORT, () => {
    console.timeEnd("Listening on port");
    console.timeEnd("Startup total");
    console.log(`Server running on port ${PORT}`);

    if (shouldStartEmbeddingWorker()) {
      console.time("Starting worker");
      startWorker();
      console.timeEnd("Starting worker");
    } else {
      console.log("Embedding worker disabled. Set ENABLE_EMBEDDING_WORKER=true to enable it.");
    }
  });
}

function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  stopWorker();

  if (!httpServer) {
    process.exit(0);
  }

  httpServer.close((error) => {
    if (error) {
      console.error("Error while closing HTTP server:", error);
      process.exit(1);
    }

    console.log("HTTP server closed.");
    process.exit(0);
  });
}

if (require.main === module) {
  startServer();
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Un rechazo suelto no debe derribar el servidor: se registra y se sigue
// atendiendo requests.
process.on("unhandledRejection", (reason) => {
  console.error("Promesa rechazada sin manejar:", reason);
});

module.exports = { app, startServer };
