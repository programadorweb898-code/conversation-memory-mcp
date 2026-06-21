const saveMessage = require('./src/tools/saveMessage');

(async () => {
  try {
    const sessionId = "session-1782004291954-rlan1qdjcvm"; // Current sessionId from getLastSessionContext
    await saveMessage({
      sessionId,
      project: "default",
      role: "assistant",
      content: "Lo último que hablamos fue sobre la integración entre Engram, Copilot y este servidor MCP. Específicamente, discutimos si yo puedo acceder directamente a la base de conocimiento de Engram, cómo Copilot consume información (indexando archivos de texto como `MEMORY.md` en lugar de herramientas), y sobre la posibilidad de instalar Engram localmente con Go para usarlo como CLI. Terminaste la sesión con la intención de comprobar si el historial se guardaba correctamente."
    });
    console.log("Message saved successfully");
  } catch (err) {
    console.error(err);
  }
})();
