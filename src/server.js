const { startWorker } = require("./services/embeddingWorker"); // Import the worker
const { startSessionMonitor } = require("./services/sessionManager"); // Import the session monitor
const app = require("./app"); // Import the assembled Express app
const { dbReadyPromise } = require("./database");

async function startServer() {
  console.time("⏱️ Startup total");
  
  await dbReadyPromise;
  console.log("Database is ready.");

  console.time("Starting worker");
  startWorker(); // Start the embedding background worker
  console.timeEnd("Starting worker");
  
  console.time("Starting session monitor");
  startSessionMonitor(); // Start the auto-finalization monitor
  console.timeEnd("Starting session monitor");
  
  const PORT = process.env.PORT || 3000;
  
  console.time("Listening on port");
  app.listen(PORT, () => {
    console.timeEnd("Listening on port");
    console.timeEnd("⏱️ Startup total");
    console.log(`✅ Server running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
