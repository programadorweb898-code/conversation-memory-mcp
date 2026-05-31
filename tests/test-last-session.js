const lastSession = require("../src/tools/lastSession");
const saveMessage = require("../src/tools/saveMessage");

async function runTest() {
  console.log("Iniciando test de recuperación de última sesión...");

  const testSessionId = `session-${Date.now()}`;
  
  // Guardamos un mensaje con una sesión única
  await saveMessage({
    sessionId: testSessionId,
    project: "test",
    role: "user",
    content: "Test para lastSession"
  });

  // Recuperamos la última sesión
  const result = await lastSession();

  console.log("Sesión recuperada:", result);
  
  if (result === testSessionId) {
    console.log("✅ Test exitoso: Se recuperó la sesión correcta.");
  } else {
    console.log(`❌ Test fallido: Se esperaba ${testSessionId} pero se obtuvo ${result}`);
  }
}

runTest().catch(console.error);
