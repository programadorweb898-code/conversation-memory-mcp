const { db, dbReady } = require("./src/database");

async function run() {
  try {
    console.log("1. Esperando inicialización de la base de datos...");
    await dbReady;
    
    console.log("2. Probando conexión básica con SELECT 1...");
    const testResult = await db.query("SELECT 1 as connection_test;");
    console.log("   ¡Conexión básica exitosa! Resultado:", testResult.rows[0]);

    console.log("3. Verificando versión de PostgreSQL y pgvector...");
    const versionRes = await db.query("SELECT version();");
    console.log("   Versión de Postgres:", versionRes.rows[0].version);

    try {
      const extRes = await db.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';");
      if (extRes.rows.length > 0) {
        console.log(`   ¡Extensión pgvector instalada! Versión: ${extRes.rows[0].extversion}`);
      } else {
        console.log("   La extensión pgvector NO está instalada en pg_extension.");
      }
    } catch (e) {
      console.log("   No se pudo verificar la extensión pgvector:", e.message);
    }

    console.log("4. Intentando crear el índice vectorial HNSW...");
    // Intentamos HNSW primero, pero si hay límites de recursos, lo capturamos
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_message_embeddings_hnsw_cosine 
      ON message_embeddings 
      USING hnsw (embedding vector_cosine_ops);
    `);
    console.log("   ¡Índice HNSW creado exitosamente en Render!");
    
  } catch (e) {
    console.error("\n❌ Error durante el diagnóstico/migración:");
    console.error("   Mensaje:", e.message);
    console.error("   Código de error:", e.code || "N/A");
    
    if (e.message.includes("Connection terminated unexpectedly")) {
      console.log("\n💡 Nota de diagnóstico: La conexión se cerró abruptamente.");
      console.log("   Esto suele ocurrir en bases de datos gratuitas de Render si:");
      console.log("   - El servidor de base de datos se quedó sin memoria (OOM) al construir el índice HNSW.");
      console.log("   - La base de datos se reinició debido a inactividad justo al intentar la operación.");
      console.log("   - Hay un límite de tiempo de ejecución de consultas (statement timeout).");
      console.log("\n👉 Intenta ejecutar el script de nuevo. Si el problema persiste, podemos probar con un índice IVFFlat, que consume mucho menos recursos en bases de datos pequeñas.");
    }
  } finally {
    await db.close();
    process.exit();
  }
}

run();
