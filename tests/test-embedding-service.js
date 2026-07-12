// tests/test-embedding-service.js

const { initializeEmbeddingPipeline, generateEmbedding, saveEmbedding, getEmbedding } = require("../src/services/embeddingService");
const { db } = require("./test-helper"); // Import the database connection

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


    // 2. Asegurar que exista la conversación de referencia para la FK
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content, timestamp)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [testMessageId, "test-session-embedding", "test-project", "user", sampleText]
    );

    // 3. Guardar el embedding
    console.log(`Guardando embedding para messageId: ${testMessageId}`);
    await saveEmbedding(testMessageId, realEmbeddingJson);
    console.log("Embedding guardado correctamente.");

    // 4. Recuperar el embedding

    // 4. Recuperar el embedding
    console.log(`Recuperando embedding para messageId: ${testMessageId}`);
    const retrievedEmbeddingJson = await getEmbedding(testMessageId);
    console.log("Embedding recuperado:", retrievedEmbeddingJson.substring(0, 50) + "...");

    // 5. Verificar que el embedding recuperado coincida con el guardado
    try {
      const normalizeEmbedding = (value) => {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          return JSON.parse(trimmed);
        }
        const withoutBrackets = trimmed.replace(/^\[/, '').replace(/\]$/, '');
        return withoutBrackets.split(',').map((entry) => Number(entry.trim())).filter((entry) => !Number.isNaN(entry));
      };
      const parsedRetrieved = normalizeEmbedding(retrievedEmbeddingJson);
      const parsedOriginal = normalizeEmbedding(realEmbeddingJson);
      const tolerance = 1e-6;
      const sameValues = Array.isArray(parsedRetrieved) && Array.isArray(parsedOriginal) && parsedRetrieved.length === parsedOriginal.length && parsedRetrieved.every((value, index) => Math.abs(value - parsedOriginal[index]) <= tolerance);
      if (sameValues) {
        console.log("✅ Prueba exitosa: El embedding recuperado coincide con el guardado.");
      } else {
        console.error("❌ Prueba fallida: El embedding recuperado NO coincide con el guardado.");
      }
    } catch (parseError) {
      console.error("❌ Prueba fallida: No se pudo comparar el embedding recuperado.", parseError);
    }
  } catch (error) {
    console.error("❌ Ocurrió un error durante las pruebas:", error);
  } finally {
    // Limpieza asíncrona segura del embedding de prueba
    try {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id = $1`, [testMessageId]);
      console.log("Embedding de prueba eliminado.");
    } catch (err) {
      console.error("Error limpiando message_embeddings:", err.message);
    }
    console.log("Pruebas finalizadas.");
  }
}

runTests();
