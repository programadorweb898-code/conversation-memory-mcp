const saveMessage = require("../src/tools/saveMessage");

async function run() {
  await saveMessage({
    sessionId: "session-1",
    project: "demo",
    role: "user",
    content: "Como hiciste el componente Login?"
  });

  console.log("Saved");
}

run();