const searchMessages = require("../src/tools/searchMessages");
const saveMessage = require("../src/tools/saveMessage");

async function runTest() {
  console.log("Iniciando test de búsqueda...");

  // Primero guardamos un mensaje para asegurar que hay algo que buscar
  const testContent = "Esta es una prueba de búsqueda de JWT";
  await saveMessage({
    sessionId: "test-session-search",
    project: "test-project",
    role: "assistant",
    content: testContent
  });

  // Buscamos el mensaje
  const results = await searchMessages({ query: "JWT" });

  console.log("Resultados encontrados:", results.length);
  
  const found = results.some(m => m.content === testContent);
  
  if (found) {
    console.log("✅ Test exitoso: Mensaje encontrado.");
  } else {
    console.log("❌ Test fallido: No se encontró el mensaje.");
  }
}

runTest().catch(console.error);
