const { startWorker, stopWorker } = require("./services/embeddingWorker");
const { startSessionMonitor, stopSessionMonitor } = require("./services/sessionManager");
const app = require("./app");
const { dbReady } = require("./database");
const dotenv=require("dotenv");
dotenv.config();
let httpServer;

function shouldStartEmbeddingWorker() {
  return process.env.ENABLE_EMBEDDING_WORKER === "true";
}

async function startServer() {
  console.time("Startup total");

  if (!process.env.MCP_BEARER_TOKEN) {
    console.error("Fatal error: MCP_BEARER_TOKEN environment variable is required.");
    process.exit(1);
  }

  await dbReady;
  console.log("Database is ready.");

  const PORT = process.env.PORT || 3000;

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

    console.time("Starting session monitor");
    startSessionMonitor();
    console.timeEnd("Starting session monitor");
  });
}

function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  stopWorker();
  stopSessionMonitor();

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

module.exports = { app, startServer };
