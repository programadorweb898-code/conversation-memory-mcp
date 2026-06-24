const { db } = require("../src/database");

async function migrate() {
  console.log("Iniciando migración a pgvector...");
  
  try {
    // 1. Habilitar la extensión
    await db.query("CREATE EXTENSION IF NOT EXISTS vector;");
    console.log("Extensión 'vector' habilitada.");

    // 2. Convertir la columna embedding de TEXT a VECTOR
    // Usaremos una conversión segura: cast text -> vector
    // Nota: El tipo vector en pgvector espera un array [x,y,z], 
    // y nuestro JSON string actual es "[x,y,z]". 
    // Postgres suele manejar esto bien con CAST(column AS vector).
    
    await db.query(`
      ALTER TABLE message_embeddings 
      ALTER COLUMN embedding TYPE vector USING embedding::vector;
    `);
    console.log("Columna 'embedding' convertida a tipo 'vector'.");

    console.log("Migración completada exitosamente.");
  } catch (err) {
    console.error("Error durante la migración:", err);
  } finally {
    process.exit();
  }
}

migrate();
