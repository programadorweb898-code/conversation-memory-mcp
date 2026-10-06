const { startWorker, stopWorker } = require("./services/embeddingWorker");
const { getConfig } = require("./config");
const app = require("./app");
const { db } = require("./database");

const { closeMcpRoutes } = app;

let httpServer;
let shutdownPromise;

function shouldStartEmbeddingWorker() {
  return getConfig().server.enableEmbeddingWorkerHttp;
}

function signalExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 0;
}

async function startServer() {
  console.time("Startup total");

  if (!getConfig().server.bearerToken) {
    console.error("Fatal error: MCP_BEARER_TOKEN environment variable is required.");
    process.exit(1);
  }

  const PORT = getConfig().server.port;

  console.time("Listening on port");
  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      try {
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

        resolve(server);
      } catch (error) {
        reject(error);
      }
    });

    server.once("error", reject);
  });

  return httpServer;
}

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    let exitCode = signalExitCode(signal);
    console.log(`${signal} received. Shutting down gracefully...`);

    let httpClosePromise = null;

    if (httpServer?.listening) {
      httpClosePromise = new Promise((resolve, reject) => {
        try {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    try {
      await closeMcpRoutes();
    } catch (error) {
      console.error("Error closing MCP transports:", error.message);
      exitCode = 1;
    }

    if (httpClosePromise) {
      try {
        await httpClosePromise;
        httpServer = undefined;
        console.log("HTTP server closed.");
      } catch (error) {
        console.error("Error while closing HTTP server:", error.message);
        exitCode = 1;
      }
    }

    try {
      await stopWorker();
    } catch (error) {
      console.error("Error stopping embedding worker:", error.message);
      exitCode = 1;
    }

    try {
      await db.close();
    } catch (error) {
      console.error("Error closing database pool:", error.message);
      exitCode = 1;
    }

    process.exit(exitCode);
  })();

  return shutdownPromise;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start HTTP server:", error);
    process.exit(1);
  });

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}

process.on("unhandledRejection", (reason) => {
  console.error("Promesa rechazada sin manejar:", reason);
});

module.exports = { app, startServer, shutdown };
