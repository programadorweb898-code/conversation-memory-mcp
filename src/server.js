const { startWorker } = require("./services/embeddingWorker"); // Import the worker
const { startSessionMonitor } = require("./services/sessionManager"); // Import the session monitor
const app = require("./app"); // Import the assembled Express app

async function startServer() {
  startWorker(); // Start the embedding background worker
  startSessionMonitor(); // Start the auto-finalization monitor
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
