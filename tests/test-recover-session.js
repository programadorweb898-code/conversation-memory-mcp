const recoverSession = require("../src/tools/recoverSession");
const saveMessage = require("../src/tools/saveMessage");

async function runTest() {
  console.log("Iniciando test de recuperación de sesión...");
  const sessionId = `test-session-${Date.now()}`;

  // 1. Guardamos dos mensajes en la misma sesión
  await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje 1" });
  await saveMessage({ sessionId, project: "test", role: "assistant", content: "Mensaje 2" });

  // 2. Recuperamos la sesión
  const messages = await recoverSession({ sessionId });

  console.log("Mensajes recuperados:", messages.length);

  // 3. Verificamos
  if (messages.length === 2 && messages[0].content === "Mensaje 1" && messages[1].content === "Mensaje 2") {
    console.log("✅ Test exitoso: Sesión recuperada correctamente en orden.");
  } else {
    console.log("❌ Test fallido: Los mensajes no coinciden o el orden es incorrecto.");
  }
}

runTest().catch(console.error);
