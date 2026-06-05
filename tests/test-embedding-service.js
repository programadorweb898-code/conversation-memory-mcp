// tests/test-embedding-service.js

const { initializeEmbeddingPipeline, generateEmbedding, saveEmbedding, getEmbedding } = require("../src/services/embeddingService");
const db = require("../src/database"); // Import the database connection

async function runTests() {
  console.log("Iniciando pruebas para embeddingService.js");

  const testMessageId = "test-message-123";
  const sampleText = "Este es un mensaje de prueba para generar un embedding real.";

  try {
    // 0. Inicializar el pipeline de embedding
    console.log("Inicializando el pipeline de embedding...");
    await initializeEmbeddingPipeline();
    console.log("Pipeline de embedding inicializado.");

    // 1. Generar un embedding real
    console.log("Generando embedding real...");
    const realEmbeddingJson = await generateEmbedding(sampleText);
    console.log("Embedding real generado:", realEmbeddingJson.substring(0, 50) + "..."); // Mostrar solo una parte

    // Verificar el embedding generado
    if (typeof realEmbeddingJson === 'string' && realEmbeddingJson.startsWith('[') && realEmbeddingJson.endsWith(']')) {
      const realEmbedding = JSON.parse(realEmbeddingJson);
      if (Array.isArray(realEmbedding) && realEmbedding.every(num => typeof num === 'number')) {
        console.log("✅ Prueba exitosa: El embedding generado es un array de números.");
        // Expected dimension for all-MiniLM-L6-v2 is 384
        if (realEmbedding.length === 384) {
          console.log(`✅ Prueba exitosa: La dimensión del embedding es ${realEmbedding.length} (esperado 384).`);
        } else {
          console.error(`❌ Prueba fallida: La dimensión del embedding es ${realEmbedding.length} (esperado 384).`);
        }
      } else {
        console.error("❌ Prueba fallida: El embedding generado no es un array de números válido.");
      }
    } else {
      console.error("❌ Prueba fallida: El embedding generado no es un string JSON válido.");
    }


    // 2. Guardar el embedding
    console.log(`Guardando embedding para messageId: ${testMessageId}`);
    await saveEmbedding(testMessageId, realEmbeddingJson);
    console.log("Embedding guardado correctamente.");

    // 3. Recuperar el embedding
    console.log(`Recuperando embedding para messageId: ${testMessageId}`);
    const retrievedEmbeddingJson = await getEmbedding(testMessageId);
    console.log("Embedding recuperado:", retrievedEmbeddingJson.substring(0, 50) + "...");

    // 4. Verificar que el embedding recuperado coincida con el guardado
    if (retrievedEmbeddingJson === realEmbeddingJson) {
      console.log("✅ Prueba exitosa: El embedding recuperado coincide con el guardado.");
    } else {
      console.error("❌ Prueba fallida: El embedding recuperado NO coincide con el guardado.");
    }
  } catch (error) {
    console.error("❌ Ocurrió un error durante las pruebas:", error);
  } finally {
    // Limpieza: Cerrar la conexión a la base de datos
    db.close((err) => {
      if (err) {
        console.error("Error al cerrar la base de datos:", err.message);
      } else {
        console.log("Conexión a la base de datos cerrada.");
      }
    });
    console.log("Pruebas finalizadas.");
  }
}

runTests();
